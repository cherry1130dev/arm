/**
 * ==========================================================================
 * Settings & Hardware Calibration Page Logic
 * ==========================================================================
 */

import { loadConfig, saveConfig, resetConfig, DEFAULT_CONFIG } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

let currentConfig = loadConfig();

// DOM references
const elements = {
  // Top / Bottom Save
  btnTopSave: document.getElementById('btnTopSave'),
  btnBottomSave: document.getElementById('btnBottomSave'),
  btnResetAll: document.getElementById('btnResetAll'),
  btnResetJointsDefault: document.getElementById('btnResetJointsDefault'),
  toastMessage: document.getElementById('toastMessage'),

  // Firebase
  fbDbUrl: document.getElementById('fbDbUrl'),
  fbApiKey: document.getElementById('fbApiKey'),
  fbProjectId: document.getElementById('fbProjectId'),
  fbAuthDomain: document.getElementById('fbAuthDomain'),
  fbRootPath: document.getElementById('fbRootPath'),
  btnTestFirebase: document.getElementById('btnTestFirebase'),
  btnFillDemoFirebase: document.getElementById('btnFillDemoFirebase'),
  fbTestStatus: document.getElementById('fbTestStatus'),

  // Camera & Rover
  camIp: document.getElementById('camIp'),
  camPort: document.getElementById('camPort'),
  camPath: document.getElementById('camPath'),
  roverSpeed: document.getElementById('roverSpeed'),
  autoBrake: document.getElementById('autoBrake'),
  soundFx: document.getElementById('soundFx')
};

// Joint IDs
const JOINTS = ['base', 'shoulder', 'elbow', 'wrist', 'gripper'];
// Preset IDs
const PRESETS = ['pick', 'pos1', 'pos2', 'pos3', 'drop', 'idle'];

// Initialize UI
function init() {
  populateForm(currentConfig);
  bindEvents();
  updateAllMeterBars();
}

/**
 * Populate form inputs from configuration object
 */
function populateForm(cfg) {
  // 1. Firebase
  elements.fbDbUrl.value = cfg.firebase.dbUrl || '';
  elements.fbApiKey.value = cfg.firebase.apiKey || '';
  elements.fbProjectId.value = cfg.firebase.projectId || '';
  elements.fbAuthDomain.value = cfg.firebase.authDomain || '';
  elements.fbRootPath.value = cfg.firebase.rootPath || '/test_bench';

  // 2. Joints
  JOINTS.forEach(joint => {
    const jData = cfg.armJoints[joint];
    if (jData) {
      const minEl = document.getElementById(`joint_${joint}_min`);
      const idealEl = document.getElementById(`joint_${joint}_ideal`);
      const maxEl = document.getElementById(`joint_${joint}_max`);

      if (minEl) minEl.value = jData.min;
      if (idealEl) idealEl.value = jData.ideal;
      if (maxEl) maxEl.value = jData.max;
    }
  });

  // 3. Presets
  PRESETS.forEach(preset => {
    const pData = cfg.presets[preset];
    if (pData && pData.angles) {
      JOINTS.forEach(joint => {
        const inputEl = document.getElementById(`preset_${preset}_${joint}`);
        if (inputEl && pData.angles[joint] !== undefined) {
          inputEl.value = pData.angles[joint];
        }
      });
    }
  });

  // 4. Camera & Rover
  if (cfg.camera) {
    elements.camIp.value = cfg.camera.ip || '192.168.1.150';
    elements.camPort.value = cfg.camera.port || 81;
    elements.camPath.value = cfg.camera.path || '/stream';
  }

  if (cfg.rover) {
    elements.roverSpeed.value = cfg.rover.speed || 70;
    elements.autoBrake.checked = cfg.rover.autoBrakeOnRelease !== false;
    elements.soundFx.checked = cfg.rover.soundFx !== false;
  }
}

/**
 * Read current form inputs into a new config object
 */
function extractFormConfig() {
  const cfg = JSON.parse(JSON.stringify(currentConfig));

  // Firebase
  cfg.firebase.dbUrl = elements.fbDbUrl.value.trim();
  cfg.firebase.apiKey = elements.fbApiKey.value.trim();
  cfg.firebase.projectId = elements.fbProjectId.value.trim();
  cfg.firebase.authDomain = elements.fbAuthDomain.value.trim();
  cfg.firebase.rootPath = elements.fbRootPath.value.trim() || '/test_bench';

  // Joints
  JOINTS.forEach(joint => {
    const minVal = parseInt(document.getElementById(`joint_${joint}_min`).value, 10) || 0;
    let idealVal = parseInt(document.getElementById(`joint_${joint}_ideal`).value, 10) || 90;
    const maxVal = parseInt(document.getElementById(`joint_${joint}_max`).value, 10) || 180;

    // Safety clamps
    const safeMin = Math.max(0, Math.min(180, minVal));
    const safeMax = Math.max(safeMin, Math.min(180, maxVal));
    const safeIdeal = Math.max(safeMin, Math.min(safeMax, idealVal));

    cfg.armJoints[joint].min = safeMin;
    cfg.armJoints[joint].ideal = safeIdeal;
    cfg.armJoints[joint].max = safeMax;
  });

  // Presets
  PRESETS.forEach(preset => {
    if (!cfg.presets[preset]) return;
    JOINTS.forEach(joint => {
      const inputEl = document.getElementById(`preset_${preset}_${joint}`);
      if (inputEl) {
        const val = parseInt(inputEl.value, 10) || 90;
        cfg.presets[preset].angles[joint] = Math.max(0, Math.min(180, val));
      }
    });
  });

  // Camera & Rover
  cfg.camera.ip = elements.camIp.value.trim() || '192.168.1.150';
  cfg.camera.port = parseInt(elements.camPort.value, 10) || 81;
  cfg.camera.path = elements.camPath.value.trim() || '/stream';

  cfg.rover.speed = parseInt(elements.roverSpeed.value, 10) || 70;
  cfg.rover.autoBrakeOnRelease = elements.autoBrake.checked;
  cfg.rover.soundFx = elements.soundFx.checked;

  return cfg;
}

/**
 * Update range meter bar for visual feedback
 */
function updateMeterBar(joint) {
  const minVal = parseInt(document.getElementById(`joint_${joint}_min`)?.value, 10) || 0;
  const idealVal = parseInt(document.getElementById(`joint_${joint}_ideal`)?.value, 10) || 90;
  const maxVal = parseInt(document.getElementById(`joint_${joint}_max`)?.value, 10) || 180;

  const meter = document.getElementById(`meter_${joint}`);
  if (!meter) return;

  const bar = meter.querySelector('.meter-bar');
  const idealMarker = meter.querySelector('.meter-ideal-marker');

  // Convert 0-180 to %
  const leftPct = (minVal / 180) * 100;
  const widthPct = Math.max(2, ((maxVal - minVal) / 180) * 100);
  const idealPct = (idealVal / 180) * 100;

  if (bar) {
    bar.style.left = `${leftPct}%`;
    bar.style.width = `${widthPct}%`;
  }
  if (idealMarker) {
    idealMarker.style.left = `${idealPct}%`;
  }
}

function updateAllMeterBars() {
  JOINTS.forEach(joint => updateMeterBar(joint));
}

/**
 * Toast notifications
 */
function showToast(text, type = 'success') {
  const toast = elements.toastMessage;
  toast.textContent = text;
  toast.className = `toast-notification toast-${type}`;
  setTimeout(() => {
    toast.className = 'toast-notification hidden';
  }, 3500);
}

/**
 * Save configuration handler
 */
function handleSave(navigateHome = false) {
  const newConfig = extractFormConfig();
  const success = saveConfig(newConfig);

  if (success) {
    currentConfig = newConfig;
    showToast('✓ Settings successfully saved to GCS storage!', 'success');
    if (navigateHome) {
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 700);
    }
  } else {
    showToast('Failed to save settings to localStorage', 'error');
  }
}

/**
 * Test Firebase Connection
 */
async function testFirebaseConnection() {
  const pill = elements.fbTestStatus;
  const pillText = pill.querySelector('.pill-text');

  pill.className = 'test-status-pill status-pending';
  pillText.textContent = 'Testing Connection...';

  const dbUrl = elements.fbDbUrl.value.trim();
  const apiKey = elements.fbApiKey.value.trim();
  const projectId = elements.fbProjectId.value.trim();
  const rootPath = elements.fbRootPath.value.trim() || '/test_bench';

  if (!dbUrl || !apiKey || !projectId) {
    pill.className = 'test-status-pill status-error';
    pillText.textContent = 'Missing required URL / Key / Project ID';
    return;
  }

  try {
    const testApp = initializeApp({
      apiKey,
      databaseURL: dbUrl,
      projectId
    }, 'TestConnectionApp_' + Date.now());

    const testDb = getDatabase(testApp);
    const pingRef = ref(testDb, `${rootPath}/ping_test`);

    await set(pingRef, {
      timestamp: Date.now(),
      client: 'Settings Verification Tester'
    });

    pill.className = 'test-status-pill status-success';
    pillText.textContent = 'Connected & Writable!';
    showToast('✓ Firebase Realtime Database is live and responsive!', 'success');
  } catch (err) {
    console.error('[TEST FB] Failed:', err);
    pill.className = 'test-status-pill status-error';
    pillText.textContent = `Error: ${err.code || err.message || 'Failed'}`;
    showToast(`Firebase test failed: ${err.message}`, 'error');
  }
}

/**
 * Load demo credentials
 */
function loadDemoCredentials() {
  elements.fbDbUrl.value = 'https://esp32-arm-rover-bench-default-rtdb.firebaseio.com';
  elements.fbApiKey.value = 'AIzaSyA8B3C9DemoKeyHardwareBench99128';
  elements.fbProjectId.value = 'esp32-arm-rover-bench';
  elements.fbAuthDomain.value = 'esp32-arm-rover-bench.firebaseapp.com';
  elements.fbRootPath.value = '/test_bench';

  showToast('Loaded demo credentials. Click Save when ready.', 'info');
}

/**
 * Reset joints to defaults
 */
function resetJointsToDefault() {
  JOINTS.forEach(j => {
    currentConfig.armJoints[j] = JSON.parse(JSON.stringify(DEFAULT_CONFIG.armJoints[j]));
  });
  populateForm(currentConfig);
  updateAllMeterBars();
  showToast('Reset arm joints to factory defaults.', 'info');
}

/**
 * Reset all settings
 */
function resetAllSettings() {
  if (confirm('Are you sure you want to reset all configurations to factory defaults?')) {
    currentConfig = resetConfig();
    populateForm(currentConfig);
    updateAllMeterBars();
    showToast('All configurations reset to factory defaults.', 'warning');
  }
}

/**
 * Bind input and button listeners
 */
function bindEvents() {
  elements.btnTopSave?.addEventListener('click', () => handleSave(false));
  elements.btnBottomSave?.addEventListener('click', () => handleSave(true));

  elements.btnTestFirebase?.addEventListener('click', testFirebaseConnection);
  elements.btnFillDemoFirebase?.addEventListener('click', loadDemoCredentials);

  elements.btnResetJointsDefault?.addEventListener('click', resetJointsToDefault);
  elements.btnResetAll?.addEventListener('click', resetAllSettings);

  // Meter live updates
  JOINTS.forEach(joint => {
    ['min', 'ideal', 'max'].forEach(type => {
      const el = document.getElementById(`joint_${joint}_${type}`);
      el?.addEventListener('input', () => updateMeterBar(joint));
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
