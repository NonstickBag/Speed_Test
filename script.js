const clientInfoEl = document.getElementById('client-info');
const clientIpEl = document.getElementById('client-ip');

const speedValueEl = document.getElementById('speed-value');
const pingUnloadedEl = document.getElementById('ping-unloaded');
const pingLoadedEl = document.getElementById('ping-loaded');
const uploadValueEl = document.getElementById('upload-value');
const dataDownEl = document.getElementById('data-down');
const dataUpEl = document.getElementById('data-up');

const speedUnitEl = document.getElementById('speed-unit');
const uploadUnitEl = document.getElementById('upload-unit');

const startBtn = document.getElementById('start-btn');

// Theme Elements
const themeToggleBtn = document.getElementById('theme-toggle');
const themeText = document.getElementById('theme-text');

// Settings Elements
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const setConnMin = document.getElementById('setting-conn-min');
const setConnMax = document.getElementById('setting-conn-max');
const setDurMin = document.getElementById('setting-dur-min');
const setDurMax = document.getElementById('setting-dur-max');
const setLatency = document.getElementById('setting-latency');
const setAlwaysShow = document.getElementById('setting-always-show');
const setSaveConfig = document.getElementById('setting-save-config');

const btnReset = document.getElementById('settings-reset');
const btnSave = document.getElementById('settings-save');
const btnCancel = document.getElementById('settings-cancel');

const advancedMetrics = document.getElementById('advanced-metrics');

// Application State
let isTesting = false;
let abortController = null;
let uploadXhrs = new Set(); 

// Active Configuration
let config = {
    connMin: 1,
    connMax: 8,
    durMin: 5,
    durMax: 10, 
    measureLatency: false,
    alwaysShow: false,
    saveConfig: false
};

// Theme Management
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('speedTestTheme', theme);
    if (themeText) {
        themeText.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('speedTestTheme');
    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'dark' : 'light');
    }
}

themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
});

// Moving Average Calculator
class SpeedTracker {
    constructor(sampleSize = 10) {
        this.samples = [];
        this.sampleSize = sampleSize;
        this.prevTime = Date.now();
        this.prevBytes = 0;
    }
    
    add(currentBytes) {
        const now = Date.now();
        const deltaBytes = currentBytes - this.prevBytes;
        const deltaTime = (now - this.prevTime) / 1000;
        
        if (deltaTime > 0) {
            const speedMbps = ((deltaBytes * 8) / deltaTime) / 1000000;
            this.samples.push(speedMbps);
            if (this.samples.length > this.sampleSize) this.samples.shift();
        }
        
        this.prevTime = now;
        this.prevBytes = currentBytes;
    }
    
    getAverage() {
        if (this.samples.length === 0) return 0;
        return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    }
}

function loadSettingsToUI() {
    setConnMin.value = config.connMin;
    setConnMax.value = config.connMax;
    setDurMin.value = config.durMin;
    setDurMax.value = config.durMax;
    setLatency.checked = config.measureLatency;
    setAlwaysShow.checked = config.alwaysShow;
    setSaveConfig.checked = config.saveConfig;
}

settingsBtn.addEventListener('click', () => {
    loadSettingsToUI(); 
    settingsPanel.classList.toggle('hidden');
});

btnCancel.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
});

btnReset.addEventListener('click', () => {
    setConnMin.value = 1;
    setConnMax.value = 8;
    setDurMin.value = 5;
    setDurMax.value = 30;
    setLatency.checked = false;
    setAlwaysShow.checked = false;
    setSaveConfig.checked = false;
});

btnSave.addEventListener('click', () => {
    config = {
        connMin: parseInt(setConnMin.value, 10),
        connMax: parseInt(setConnMax.value, 10),
        durMin: parseInt(setDurMin.value, 10),
        durMax: parseInt(setDurMax.value, 10),
        measureLatency: setLatency.checked,
        alwaysShow: setAlwaysShow.checked,
        saveConfig: setSaveConfig.checked
    };
    
    if (config.saveConfig) {
        localStorage.setItem('speedTestConfig', JSON.stringify(config));
    } else {
        localStorage.removeItem('speedTestConfig');
    }
    settingsPanel.classList.add('hidden');
});

try {
    const saved = localStorage.getItem('speedTestConfig');
    if (saved) config = JSON.parse(saved);
} catch(e) {}

async function fetchNetworkDetails() {
    try {
        let response = await fetch('https://api.db-ip.com/v2/free/self');
        if (response.ok) {
            const data = await response.json();
            clientIpEl.textContent = data.ipAddress || 'Unknown IP';
            clientInfoEl.textContent = `${data.city || 'Unknown City'}, ${data.countryCode || 'Unknown'}`;
            return;
        }
        
        response = await fetch('https://ipinfo.io/json');
        if (response.ok) {
            const data = await response.json();
            clientIpEl.textContent = data.ip || 'Unknown IP';
            clientInfoEl.textContent = `${data.city || 'Unknown City'}, ${data.country || 'Unknown'}`;
        } else {
            throw new Error('Network lookup APIs failed');
        }
    } catch (error) {
        clientIpEl.textContent = 'Unavailable';
        clientInfoEl.textContent = 'Unavailable Location';
    }
}

async function measurePing(samples = 3) {
    let minPing = Infinity;
    for (let i = 0; i < samples; i++) {
        try {
            const start = performance.now();
            await fetch('https://speed.cloudflare.com/__down?bytes=0', { cache: 'no-store' });
            const duration = Math.round(performance.now() - start);
            if (duration < minPing) minPing = duration;
        } catch {
            continue;
        }
    }
    return minPing === Infinity ? 0 : minPing;
}

function updateSpeedDisplay(element, unitElement, speedMbps) {
    if (speedMbps > 0 && speedMbps < 1) {
        element.textContent = (speedMbps * 1000).toFixed(0);
        unitElement.textContent = 'Kbps';
    } else {
        element.textContent = speedMbps > 0 ? speedMbps.toFixed(0) : '0';
        unitElement.textContent = 'Mbps';
    }
}

async function runSecondaryTests() {
    pingUnloadedEl.textContent = '...';
    const ping = await measurePing();
    pingUnloadedEl.textContent = ping > 0 ? ping : 'ERR';
    
    if (config.measureLatency) {
        pingLoadedEl.textContent = '...';
        setTimeout(async () => {
            if (!isTesting) return;
            const loadedPing = await measurePing(1);
            pingLoadedEl.textContent = loadedPing > 0 ? loadedPing : 'ERR';
        }, 2000);
    }

    uploadValueEl.textContent = '0';
    uploadValueEl.classList.add('pulsing');
    
    const testDuration = config.durMax * 1000;
    const startTime = Date.now();
    let totalLoaded = 0;
    const tracker = new SpeedTracker(10);
    
    const chunkSize = 15 * 1024 * 1024; 
    const payload = new Uint8Array(chunkSize);

    const updateUI = setInterval(() => {
        let currentPending = 0;
        uploadXhrs.forEach(xhr => currentPending += (xhr.currentProgress || 0));
        const totalBytes = totalLoaded + currentPending;
        
        tracker.add(totalBytes);
        updateSpeedDisplay(uploadValueEl, uploadUnitEl, tracker.getAverage());
        dataUpEl.textContent = (totalBytes / 1000000).toFixed(1) + 'MB';
    }, 200);

    const runUploadStream = async () => {
        while (Date.now() - startTime < testDuration && isTesting) {
            await new Promise((resolve) => {
                const xhr = new XMLHttpRequest();
                xhr.currentProgress = 0;
                uploadXhrs.add(xhr);
                
                xhr.upload.onprogress = (event) => xhr.currentProgress = event.loaded;
                xhr.onload = xhr.onerror = xhr.onabort = () => {
                    totalLoaded += xhr.currentProgress;
                    uploadXhrs.delete(xhr);
                    resolve();
                };

                xhr.open('POST', 'https://speed.cloudflare.com/__up', true);
                xhr.setRequestHeader('Content-Type', 'application/octet-stream');
                xhr.send(payload);
            });
        }
    };

    const uploadTasks = Array.from({ length: config.connMax }, runUploadStream);
    await Promise.all(uploadTasks);
    
    clearInterval(updateUI);
    uploadValueEl.classList.remove('pulsing');
    
    if (isTesting) {
        updateSpeedDisplay(uploadValueEl, uploadUnitEl, tracker.getAverage());
    }
}

async function runSpeedTest() {
    if (isTesting) {
        resetUI();
        return;
    }
    
    isTesting = true;
    startBtn.classList.add('spinning');
    speedValueEl.classList.add('pulsing');
    
    advancedMetrics.style.opacity = config.alwaysShow ? '1' : '0.3';
    
    speedValueEl.textContent = '0';
    pingUnloadedEl.textContent = '--';
    pingLoadedEl.textContent = '--';
    uploadValueEl.textContent = '--';
    speedUnitEl.textContent = 'Mbps';
    uploadUnitEl.textContent = 'Mbps';
    dataDownEl.textContent = '0.0MB';
    dataUpEl.textContent = '0.0MB';

    const testDuration = config.durMax * 1000;
    const startTime = Date.now();
    let receivedBytes = 0;
    const tracker = new SpeedTracker(15); 

    abortController = new AbortController();

    const updateUI = setInterval(() => {
        tracker.add(receivedBytes);
        updateSpeedDisplay(speedValueEl, speedUnitEl, tracker.getAverage());
        dataDownEl.textContent = (receivedBytes / 1000000).toFixed(1) + 'MB';
    }, 150);

    const timeoutId = setTimeout(() => {
        if (abortController) abortController.abort();
    }, testDuration);

    const runDownloadStream = async () => {
        try {
            while (Date.now() - startTime < testDuration) {
                const response = await fetch(`https://speed.cloudflare.com/__down?bytes=25000000`, {
                    signal: abortController.signal,
                    cache: 'no-store'
                });

                if (!response.ok) throw new Error('Download request failed');
                const reader = response.body.getReader();
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) receivedBytes += value.length;
                }
            }
        } catch (err) {}
    };

    const downloadTasks = Array.from({ length: config.connMax }, runDownloadStream);
    await Promise.all(downloadTasks);

    clearInterval(updateUI);
    clearTimeout(timeoutId);
    speedValueEl.classList.remove('pulsing');

    if (!isTesting) return; 

    updateSpeedDisplay(speedValueEl, speedUnitEl, tracker.getAverage());
    advancedMetrics.style.opacity = '1';
    
    await runSecondaryTests();

    isTesting = false;
    startBtn.classList.remove('spinning');
}

function resetUI() {
    isTesting = false;
    startBtn.classList.remove('spinning');
    speedValueEl.classList.remove('pulsing');
    uploadValueEl.classList.remove('pulsing');
    
    speedValueEl.textContent = '0';
    speedUnitEl.textContent = 'Mbps';
    advancedMetrics.style.opacity = '1';
    
    if (abortController) abortController.abort();
    uploadXhrs.forEach(xhr => xhr.abort());
    uploadXhrs.clear();
}

startBtn.addEventListener('click', runSpeedTest);

window.onload = () => {
    initTheme();
    fetchNetworkDetails();
};
