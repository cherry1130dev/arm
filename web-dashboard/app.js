/**
 * ==========================================================================
 * 5-DOF Robotic Arm & Rover Teleoperation Controller
 * Interactive Kinematics Simulation Engine & Firebase RTDB Manager
 * ==========================================================================
 */

import { loadConfig } from './config.js';
import { sfx } from './soundFx.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { 
  getDatabase, 
  ref, 
  set, 
  update,
  onValue, 
  off 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// Load Persistent Configuration
let config = loadConfig();

// App State
const state = {
  firebaseApp: null,
  firebaseDb: null,
  dbRef: null,
  isFirebaseConnected: false,
  
  // View mode: 'sim' (Arm Simulation) or 'stream' (Live Camera)
  viewMode: 'sim',
  
  // Stream
  streamActive: false,
  frameCount: 0,
  lastFpsTimestamp: performance.now(),
  currentFps: 0,
  
  // Arm Joint Angles (initialized to ideal defaults from settings)
  armAngles: {
    base: config.armJoints.base.ideal,
    shoulder: config.armJoints.shoulder.ideal,
    elbow: config.armJoints.elbow.ideal,
    wrist: config.armJoints.wrist.ideal,
    gripper: config.armJoints.gripper.ideal
  },
  // Smooth animation interpolation targets
  targetAngles: {
    base: config.armJoints.base.ideal,
    shoulder: config.armJoints.shoulder.ideal,
    elbow: config.armJoints.elbow.ideal,
    wrist: config.armJoints.wrist.ideal,
    gripper: config.armJoints.gripper.ideal
  },
  isAnimating: false,
  activeJoint: 'base',
  
  // Rover
  roverSpeed: config.rover.speed || 70,
  activeKeys: new Set(),
  lightsOn: false,
  
  // Telemetry & Latency
  lastCommandSent: null,
  lastCommandTimestamp: null,
  missionStartTime: Date.now(),
  debounceTimers: {}
};

const JOINTS = ['base', 'shoulder', 'elbow', 'wrist', 'gripper'];

// DOM Element Cache
const dom = {
  // Top Badges
  dotFirebase: document.getElementById('dotFirebase'),
  textFirebase: document.getElementById('textFirebase'),
  textLatency: document.getElementById('textLatency'),
  textNodeHeartbeat: document.getElementById('textNodeHeartbeat'),
  btnToggleAudio: document.getElementById('btnToggleAudio'),
  audioText: document.getElementById('audioText'),
  
  // View Tabs
  tabSim: document.getElementById('tabSim'),
  tabStream: document.getElementById('tabStream'),
  
  // Viewport
  robotViewport: document.getElementById('robotViewport'),
  armSimCanvas: document.getElementById('armSimCanvas'),
  streamImage: document.getElementById('streamImage'),
  eePosText: document.getElementById('eePosText'),
  clawStateText: document.getElementById('clawStateText'),
  simFpsText: document.getElementById('simFpsText'),
  fpsLabel: document.getElementById('fpsLabel'),
  btnResetView: document.getElementById('btnResetView'),
  btnSnapshot: document.getElementById('btnSnapshot'),
  btnFullscreen: document.getElementById('btnFullscreen'),
  
  // Stream Options
  inputCamIp: document.getElementById('inputCamIp'),
  inputCamPort: document.getElementById('inputCamPort'),
  inputCamPath: document.getElementById('inputCamPath'),
  btnConnectStream: document.getElementById('btnConnectStream'),

  // Arm Sliders & Presets
  presetButtons: document.querySelectorAll('.preset-action-btn'),

  // Rover RC Controls
  dpadButtons: document.querySelectorAll('.dpad-btn'),
  speedPills: document.querySelectorAll('.speed-pill'),
  btnRoverLights: document.getElementById('btnRoverLights'),
  btnRoverHorn: document.getElementById('btnRoverHorn'),
  
  // Keyboard Modal Popup
  btnOpenKeyModal: document.getElementById('btnOpenKeyModal'),
  btnCloseKeyModal: document.getElementById('btnCloseKeyModal'),
  btnOkKeyModal: document.getElementById('btnOkKeyModal'),
  keyboardModal: document.getElementById('keyboardModal'),

  // Terminal & Feedback
  feedbackCmd: document.getElementById('feedbackCmd'),
  feedbackAck: document.getElementById('feedbackAck'),
  feedbackLatency: document.getElementById('feedbackLatency'),
  feedbackUptime: document.getElementById('feedbackUptime'),
  btnToggleTerminal: document.getElementById('btnToggleTerminal'),
  terminalDrawer: document.getElementById('terminalDrawer'),
  btnClearLog: document.getElementById('btnClearLog'),
  terminalLog: document.getElementById('terminalLog')
};

/**
 * App Initialization
 */
function init() {
  logEvent('system', 'Robotics teleoperation controller initializing...');

  // 1. Setup Joint Sliders from Configuration
  setupJointSliders();

  // 2. Setup Camera Defaults from Configuration
  setupCameraDefaults();

  // 3. Connect to Firebase if configured
  initFirebase();

  // 4. Start Arm Kinematics Canvas Simulation Engine
  initArmSimulation();

  // 5. Bind All Interactive UI Events
  bindViewEvents();
  bindArmEvents();
  bindRoverEvents();
  bindKeyboardEvents();
  bindModalEvents();
  bindTerminalEvents();

  // 6. Start Mission Clock
  setInterval(updateMissionClock, 1000);

  logEvent('system', 'Ready. 5-DOF Arm Kinematics simulation running.');
}

/**
 * Configure Joint Sliders with Min, Max, and Default Ideal (Center) Values
 */
function setupJointSliders() {
  JOINTS.forEach(joint => {
    const jConfig = config.armJoints[joint];
    if (!jConfig) return;

    const slider = document.getElementById(`slider_${joint}`);
    const badge = document.getElementById(`badge_${joint}`);
    const hint = document.getElementById(`hint_${joint}`);
    const idealMarker = document.getElementById(`ideal_marker_${joint}`);

    if (slider) {
      slider.min = jConfig.min;
      slider.max = jConfig.max;
      slider.value = jConfig.ideal;
      state.armAngles[joint] = jConfig.ideal;
      state.targetAngles[joint] = jConfig.ideal;
    }

    if (badge) {
      badge.textContent = `${jConfig.ideal}°`;
    }

    if (hint) {
      hint.textContent = `Min: ${jConfig.min}° • Ideal: ${jConfig.ideal}° • Max: ${jConfig.max}°`;
    }

    // Position the ideal indicator marker along the slider track
    if (idealMarker && jConfig.max > jConfig.min) {
      const pct = ((jConfig.ideal - jConfig.min) / (jConfig.max - jConfig.min)) * 100;
      idealMarker.style.left = `${pct}%`;
    }
  });
}

function setupCameraDefaults() {
  if (config.camera) {
    if (dom.inputCamIp) dom.inputCamIp.value = config.camera.ip || '192.168.1.150';
    if (dom.inputCamPort) dom.inputCamPort.value = config.camera.port || 81;
    if (dom.inputCamPath) dom.inputCamPath.value = config.camera.path || '/stream';
  }
}

/**
 * Firebase Realtime Database Integration
 */
function initFirebase() {
  const fb = config.firebase;
  if (!fb || !fb.dbUrl || !fb.apiKey || !fb.projectId) {
    updateFirebaseStatus(false, 'NO CONFIG (OPEN SETTINGS)');
    logEvent('warn', 'Firebase not configured. Open Settings to enter credentials.');
    return;
  }

  updateFirebaseStatus(false, 'CONNECTING...');

  try {
    state.firebaseApp = initializeApp({
      apiKey: fb.apiKey,
      databaseURL: fb.dbUrl,
      projectId: fb.projectId,
      authDomain: fb.authDomain || undefined
    }, 'RoboticsCockpitApp_' + Date.now());

    state.firebaseDb = getDatabase(state.firebaseApp);
    const rootPath = fb.rootPath || '/test_bench';
    state.dbRef = ref(state.firebaseDb, rootPath);

    // Attach stream listener for incoming hardware acknowledgments
    onValue(state.dbRef, (snapshot) => {
      if (snapshot.exists()) {
        handleIncomingData(snapshot.val());
      }
    }, (error) => {
      console.error('[FIREBASE] Sync error:', error);
      updateFirebaseStatus(false, 'SYNC ERROR');
      logEvent('warn', `Firebase stream error: ${error.message}`);
    });

    // Check online status
    const connectedRef = ref(state.firebaseDb, '.info/connected');
    onValue(connectedRef, (snap) => {
      const isOnline = snap.val() === true;
      state.isFirebaseConnected = isOnline;
      if (isOnline) {
        updateFirebaseStatus(true, 'ONLINE');
        logEvent('system', 'Firebase Realtime Database connected.');
      } else {
        updateFirebaseStatus(false, 'OFFLINE');
      }
    });

  } catch (err) {
    console.error('[FIREBASE INIT FAILED]', err);
    updateFirebaseStatus(false, 'INIT FAILED');
  }
}

function updateFirebaseStatus(online, label) {
  if (dom.dotFirebase) {
    dom.dotFirebase.className = `pill-dot ${online ? 'connected' : 'disconnected'}`;
  }
  if (dom.textFirebase) {
    dom.textFirebase.textContent = label;
  }
}

function handleIncomingData(data) {
  if (!data) return;

  if (data.device_ack) {
    let ackText = '';
    if (typeof data.device_ack === 'string') {
      ackText = data.device_ack;
    } else if (typeof data.device_ack === 'object') {
      ackText = data.device_ack.status || JSON.stringify(data.device_ack);
      if (data.device_ack.device_uptime_ms) {
        const upSec = Math.floor(data.device_ack.device_uptime_ms / 1000);
        if (dom.textNodeHeartbeat) dom.textNodeHeartbeat.textContent = `${upSec}s UP`;
      }
    }

    if (dom.feedbackAck) dom.feedbackAck.textContent = ackText;

    if (state.lastCommandTimestamp) {
      const rtt = Math.round(performance.now() - state.lastCommandTimestamp);
      if (dom.feedbackLatency) dom.feedbackLatency.textContent = `${rtt} ms`;
      if (dom.textLatency) dom.textLatency.textContent = `${rtt} ms`;
      state.lastCommandTimestamp = null;
    }

    logEvent('ack', `[ESP ACK] ${ackText}`);
  }

  if (data.heartbeat) {
    if (dom.textNodeHeartbeat) dom.textNodeHeartbeat.textContent = 'ONLINE';
  }
}

/**
 * Dispatch Unique Command to Firebase RTDB
 */
async function sendCommand(cmdString, extraPayload = null) {
  sfx.playClick();
  state.lastCommandSent = cmdString;
  state.lastCommandTimestamp = performance.now();

  if (dom.feedbackCmd) dom.feedbackCmd.textContent = cmdString;
  logEvent('cmd', `[TX COMMAND] ${cmdString}`);

  if (!state.firebaseDb || !state.isFirebaseConnected) return;

  try {
    const rootPath = config.firebase.rootPath || '/test_bench';
    const payload = {
      command: cmdString,
      timestamp: Date.now()
    };

    if (extraPayload) {
      Object.assign(payload, extraPayload);
    }

    await update(ref(state.firebaseDb, rootPath), payload);
  } catch (err) {
    console.error('[SEND CMD ERROR]', err);
  }
}

/**
 * Sync Arm Joint Angles to Firebase
 */
function syncArmAngles(targetJoint = null) {
  const currentAngles = { ...state.armAngles };
  const rootPath = config.firebase.rootPath || '/test_bench';

  if (state.debounceTimers.arm) {
    clearTimeout(state.debounceTimers.arm);
  }

  state.debounceTimers.arm = setTimeout(async () => {
    if (!state.firebaseDb || !state.isFirebaseConnected) return;

    try {
      const payload = {
        arm_angles: currentAngles,
        servo_angle: currentAngles[targetJoint || 'base'],
        last_joint: targetJoint || 'base'
      };

      await update(ref(state.firebaseDb, rootPath), payload);
    } catch (err) {
      console.error('[SYNC ARM ERROR]', err);
    }
  }, 40);
}

/**
 * Smoothly Interpolate Arm Angles to Target Pose (Animates arm movement)
 */
function animateToAngles(targetAngles, durationMs = 350) {
  const startAngles = { ...state.armAngles };
  const startTime = performance.now();
  state.isAnimating = true;

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    // Smooth ease-in-out quadratic curve
    const ease = progress < 0.5 
      ? 2 * progress * progress 
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    JOINTS.forEach(j => {
      if (targetAngles[j] !== undefined) {
        state.armAngles[j] = Math.round(startAngles[j] + (targetAngles[j] - startAngles[j]) * ease);
        
        // Update DOM slider & badge
        const slider = document.getElementById(`slider_${j}`);
        const badge = document.getElementById(`badge_${j}`);
        if (slider) slider.value = state.armAngles[j];
        if (badge) badge.textContent = `${state.armAngles[j]}°`;
      }
    });

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      state.isAnimating = false;
      syncArmAngles();
    }
  }

  requestAnimationFrame(step);
}

/**
 * Apply Pose Preset with Smooth Animation & Unique Command Dispatch
 */
function applyPosePreset(presetId) {
  const preset = config.presets[presetId];
  if (!preset) return;

  sfx.playPreset();
  const uniqueCmd = preset.cmd || presetId;

  // Animate the simulated robotic arm and sliders
  animateToAngles(preset.angles, 400);

  // Dispatch Unique Command (pic, pos1, drop, idle...) to ESP
  sendCommand(uniqueCmd, {
    arm_angles: preset.angles,
    preset_name: preset.name
  });
}

/**
 * ==========================================================================
 * REAL-TIME ROBOTIC ARM 2D/3D KINEMATICS SIMULATION ENGINE
 * ==========================================================================
 */
function initArmSimulation() {
  const canvas = dom.armSimCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width = 640;
  canvas.height = 480;

  let lastFpsCalc = performance.now();
  let frameCounter = 0;

  function renderKinematics() {
    if (state.viewMode === 'sim') {
      drawRoboticArmScene(ctx, canvas.width, canvas.height);
      
      // Calculate Simulation FPS
      frameCounter++;
      const now = performance.now();
      if (now - lastFpsCalc >= 1000) {
        dom.simFpsText.textContent = frameCounter;
        frameCounter = 0;
        lastFpsCalc = now;
      }
    }

    requestAnimationFrame(renderKinematics);
  }

  requestAnimationFrame(renderKinematics);
}

/**
 * Draw Complete Industrial Robotic Arm Scene
 */
function drawRoboticArmScene(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);

  // 1. Dark Engineering Workcell Background
  const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, width / 1.2);
  bgGrad.addColorStop(0, '#0a1322');
  bgGrad.addColorStop(1, '#03070e');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Isometric Grid Floor & Workcell Ground Plane
  drawWorkcellGrid(ctx, width, height);

  // Origin for Robot Arm Base (Lower center of canvas)
  const baseX = width * 0.45;
  const baseY = height * 0.82;

  // Angles in degrees
  const baseAngle = state.armAngles.base;         // J1: 0° - 180° (Turret yaw / depth)
  const shoulderAngle = state.armAngles.shoulder; // J2: 15° - 165° (Main lift boom)
  const elbowAngle = state.armAngles.elbow;       // J3: 0° - 180° (Forearm)
  const wristAngle = state.armAngles.wrist;       // J4: 0° - 180° (End tool pitch)
  const gripperAngle = state.armAngles.gripper;   // J5: 20° (closed) - 140° (open)

  // Arm Link Lengths (pixels)
  const L1 = 115; // Shoulder boom
  const L2 = 100; // Forearm
  const L3 = 45;  // Wrist & tool flange

  // Base Pedestal Mount
  drawRobotBase(ctx, baseX, baseY, baseAngle);

  // Shoulder Joint coordinates (Pivot J2)
  const shoulderX = baseX;
  const shoulderY = baseY - 32;

  // Convert Shoulder angle (0° = horizontal back, 90° = vertical up, 180° = horizontal forward)
  // In canvas coords (up is negative Y):
  const theta1 = (180 - shoulderAngle) * (Math.PI / 180);
  const elbowX = shoulderX + L1 * Math.cos(theta1);
  const elbowY = shoulderY - L1 * Math.sin(theta1);

  // Convert Elbow angle relative to shoulder
  const theta2 = theta1 - (elbowAngle - 90) * (Math.PI / 180);
  const wristX = elbowX + L2 * Math.cos(theta2);
  const wristY = elbowY - L2 * Math.sin(theta2);

  // Convert Wrist angle
  const theta3 = theta2 - (wristAngle - 90) * (Math.PI / 180);
  const toolX = wristX + L3 * Math.cos(theta3);
  const toolY = wristY - L3 * Math.sin(theta3);

  // 3. Draw Maximum Reach Boundary Envelope (Faint dashed arc)
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(shoulderX, shoulderY, L1 + L2 + L3, Math.PI, 0);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4. Target Payload / Workpiece Block on the Table
  const targetObjX = width * 0.72;
  const targetObjY = baseY - 10;
  const distToTarget = Math.hypot(toolX - targetObjX, toolY - targetObjY);
  const isTargetGrasped = distToTarget < 35 && gripperAngle < 60;

  drawTargetWorkpiece(ctx, targetObjX, targetObjY, isTargetGrasped);

  // 5. Draw Robotic Arm Links (Shoulder to Elbow, Elbow to Wrist)
  drawArmLink(ctx, shoulderX, shoulderY, elbowX, elbowY, 18, '#00d2ff', '#1e40af', 'LINK 1 (BOOM)');
  drawArmLink(ctx, elbowX, elbowY, wristX, wristY, 14, '#38bdf8', '#0369a1', 'LINK 2 (FOREARM)');

  // 6. Draw Joint Pivot Actuators with Glowing Hubs
  drawJointActuator(ctx, shoulderX, shoulderY, 14, `J2: ${shoulderAngle}°`);
  drawJointActuator(ctx, elbowX, elbowY, 12, `J3: ${elbowAngle}°`);
  drawJointActuator(ctx, wristX, wristY, 10, `J4: ${wristAngle}°`);

  // 7. Draw End-Effector Gripper Claw (Articulated based on Gripper angle)
  drawGripperClaw(ctx, wristX, wristY, toolX, toolY, theta3, gripperAngle, isTargetGrasped);

  // 8. Update Live Telemetry Overlays
  const eeMmX = Math.round((toolX - shoulderX) * 2.2);
  const eeMmY = Math.round((shoulderY - toolY) * 2.2);
  if (dom.eePosText) {
    dom.eePosText.textContent = `X: ${eeMmX > 0 ? '+' : ''}${eeMmX}mm | Y: +${eeMmY}mm`;
  }
  if (dom.clawStateText) {
    const clawPct = Math.round(((gripperAngle - 20) / (140 - 20)) * 100);
    dom.clawStateText.textContent = isTargetGrasped ? 'STATUS: [PAYLOAD GRASPED]' : `CLAW: ${clawPct}% (${gripperAngle}°)`;
    dom.clawStateText.style.color = isTargetGrasped ? '#10b981' : '#00d2ff';
  }
}

/**
 * Draw Workcell Grid Floor
 */
function drawWorkcellGrid(ctx, width, height) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;

  const groundY = height * 0.82;

  // Ground horizon / base platform line
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(30, groundY);
  ctx.lineTo(width - 30, groundY);
  ctx.stroke();

  // Vertical measurement ticks
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.15)';
  ctx.lineWidth = 1;
  for (let x = 60; x < width - 40; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x, groundY + 14);
    ctx.stroke();
  }

  // Engineering grid labels
  ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
  ctx.font = '9px "JetBrains Mono"';
  ctx.fillText('WORKCELL CALIBRATION GRID // UNIT: 50mm', 34, groundY + 28);
}

/**
 * Draw Robot Turret Base
 */
function drawRobotBase(ctx, x, y, baseAngle) {
  // Base Pedestal
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#00d2ff';
  ctx.lineWidth = 2;

  // Trapezoid base
  ctx.beginPath();
  ctx.moveTo(x - 45, y);
  ctx.lineTo(x + 45, y);
  ctx.lineTo(x + 28, y - 24);
  ctx.lineTo(x - 28, y - 24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Turret Swivel Head
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(x, y - 24, 22, Math.PI, 0);
  ctx.fill();
  ctx.stroke();

  // Base Azimuth Indicator Arc
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  const azimuthRad = ((baseAngle - 90) * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(x, y - 24, 15, Math.PI, Math.PI + (baseAngle / 180) * Math.PI);
  ctx.stroke();

  // Base Label
  ctx.fillStyle = '#f59e0b';
  ctx.font = '9px "JetBrains Mono"';
  ctx.fillText(`J1 (BASE): ${baseAngle}°`, x - 34, y + 16);
}

/**
 * Draw Robotic Arm Metallic Segment Link
 */
function drawArmLink(ctx, x1, y1, x2, y2, width, colStart, colEnd, label) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.translate(x1, y1);
  ctx.rotate(angle);

  // Link Shadow
  ctx.shadowColor = 'rgba(0, 210, 255, 0.35)';
  ctx.shadowBlur = 8;

  // Gradient Link Body
  const linkGrad = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
  linkGrad.addColorStop(0, '#38bdf8');
  linkGrad.addColorStop(0.5, '#0f172a');
  linkGrad.addColorStop(1, '#0284c7');

  ctx.fillStyle = linkGrad;
  ctx.strokeStyle = 'rgba(0, 210, 255, 0.7)';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.roundRect(0, -width / 2, len, width, [width / 2]);
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;

  // Metallic Lightening Cutouts
  ctx.fillStyle = 'rgba(3, 7, 14, 0.7)';
  const cutoutCount = Math.floor(len / 30);
  for (let i = 1; i <= cutoutCount; i++) {
    const cx = (len / (cutoutCount + 1)) * i;
    ctx.beginPath();
    ctx.arc(cx, 0, width / 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Draw Joint Actuator Hub with Angle
 */
function drawJointActuator(ctx, x, y, radius, label) {
  // Servo housing
  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#00d2ff';
  ctx.lineWidth = 2.5;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Center bolt pin
  ctx.fillStyle = '#00d2ff';
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Floating Joint Label
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '9px "JetBrains Mono"';
  ctx.fillText(label, x + radius + 4, y - 4);
}

/**
 * Draw Articulated Gripper End-Effector
 */
function drawGripperClaw(ctx, wristX, wristY, toolX, toolY, angle, gripperAngle, isGrasped) {
  ctx.save();
  ctx.translate(toolX, toolY);
  ctx.rotate(angle);

  // Tool mount bracket
  ctx.fillStyle = '#1e293b';
  ctx.strokeStyle = isGrasped ? '#10b981' : '#00d2ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.rect(-6, -10, 12, 20);
  ctx.fill();
  ctx.stroke();

  // Jaw spread proportional to gripper angle (20° closed to 140° open)
  const spread = 6 + (gripperAngle / 140) * 16;

  // Upper Claw Jaw
  ctx.strokeStyle = isGrasped ? '#10b981' : '#ef4444';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(6, -6);
  ctx.lineTo(16, -spread);
  ctx.lineTo(24, -spread + 4);
  ctx.stroke();

  // Lower Claw Jaw
  ctx.beginPath();
  ctx.moveTo(6, 6);
  ctx.lineTo(16, spread);
  ctx.lineTo(24, spread - 4);
  ctx.stroke();

  ctx.restore();
}

/**
 * Draw Target Workpiece (Payload Block)
 */
function drawTargetWorkpiece(ctx, x, y, isGrasped) {
  const w = 32;
  const h = 24;

  ctx.fillStyle = isGrasped ? '#10b981' : '#f59e0b';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h, w, h, [4]);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = '8px "JetBrains Mono"';
  ctx.fillText(isGrasped ? 'GRASPED' : 'PAYLOAD', x - 18, y - 8);
}

/**
 * View Tabs (Arm Simulation vs Live Camera)
 */
function bindViewEvents() {
  dom.tabSim?.addEventListener('click', () => {
    state.viewMode = 'sim';
    dom.tabSim.classList.add('active');
    dom.tabStream.classList.remove('active');
    dom.armSimCanvas.style.display = 'block';
    dom.streamImage.style.display = 'none';
    dom.fpsLabel.textContent = 'SIM FPS:';
  });

  dom.tabStream?.addEventListener('click', () => {
    state.viewMode = 'stream';
    dom.tabStream.classList.add('active');
    dom.tabSim.classList.remove('active');
    dom.armSimCanvas.style.display = 'none';
    dom.streamImage.style.display = 'block';
    dom.fpsLabel.textContent = 'CAM FPS:';

    // Auto connect stream if not active
    if (!state.streamActive) {
      connectStream();
    }
  });

  // Reset View
  dom.btnResetView?.addEventListener('click', () => {
    sfx.playClick();
    animateToAngles({
      base: config.armJoints.base.ideal,
      shoulder: config.armJoints.shoulder.ideal,
      elbow: config.armJoints.elbow.ideal,
      wrist: config.armJoints.wrist.ideal,
      gripper: config.armJoints.gripper.ideal
    });
    logEvent('system', 'View reset: Joint sliders centered to ideal defaults.');
  });

  // Snapshot
  dom.btnSnapshot?.addEventListener('click', captureSnapshot);

  // Fullscreen
  dom.btnFullscreen?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      dom.robotViewport.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  });

  // Connect Stream Button
  dom.btnConnectStream?.addEventListener('click', () => {
    if (state.streamActive) {
      disconnectStream();
    } else {
      connectStream();
    }
  });

  // Audio Toggle
  dom.btnToggleAudio?.addEventListener('click', () => {
    const isEnabled = sfx.toggleSound();
    dom.audioText.textContent = `SFX: ${isEnabled ? 'ON' : 'MUTE'}`;
  });
}

function connectStream() {
  const ip = dom.inputCamIp.value.trim();
  const port = dom.inputCamPort.value.trim();
  const path = dom.inputCamPath.value.trim();

  if (!ip) {
    alert('Please enter a valid ESP32-CAM IP address');
    return;
  }

  const streamUrl = `http://${ip}:${port}${path}`;
  logEvent('system', `Connecting to ESP32-CAM stream: ${streamUrl}`);

  dom.streamImage.src = streamUrl;
  state.streamActive = true;
  state.frameCount = 0;
  state.lastFpsTimestamp = performance.now();

  dom.btnConnectStream.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
      <rect x="6" y="6" width="12" height="12"/>
    </svg>
    Disconnect
  `;
  dom.btnConnectStream.classList.add('btn-danger');

  dom.streamImage.onload = () => {
    onStreamFrame();
  };
  dom.streamImage.onerror = () => {
    logEvent('warn', 'Camera feed offline. Recheck IP and ensure ESP32-CAM is powered.');
  };
}

function disconnectStream() {
  state.streamActive = false;
  dom.streamImage.src = '';

  dom.btnConnectStream.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    Connect Stream
  `;
  dom.btnConnectStream.classList.remove('btn-danger');
  logEvent('system', 'Camera stream disconnected.');
}

function onStreamFrame() {
  state.frameCount++;
  const now = performance.now();
  const elapsed = now - state.lastFpsTimestamp;

  if (elapsed >= 1000) {
    state.currentFps = Math.round((state.frameCount * 1000) / elapsed);
    if (dom.simFpsText) dom.simFpsText.textContent = state.currentFps;
    state.frameCount = 0;
    state.lastFpsTimestamp = now;
  }
}

function captureSnapshot() {
  sfx.playClick();
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  if (state.viewMode === 'stream' && dom.streamImage.naturalWidth) {
    ctx.drawImage(dom.streamImage, 0, 0, 640, 480);
  } else {
    drawRoboticArmScene(ctx, 640, 480);
  }

  // Draw Timestamp Watermark
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(10, 445, 310, 25);
  ctx.fillStyle = '#00d2ff';
  ctx.font = '11px "JetBrains Mono"';
  ctx.fillText(`ARM TELEOP CAPTURE • ${new Date().toISOString()}`, 16, 462);

  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/jpeg', 0.92);
  a.download = `robot_teleop_${Date.now()}.jpg`;
  a.click();

  logEvent('system', 'Snapshot saved.');
}

/**
 * Bind Arm Controls & Presets
 */
function bindArmEvents() {
  // Sliders Input Listeners
  JOINTS.forEach(joint => {
    const slider = document.getElementById(`slider_${joint}`);
    const badge = document.getElementById(`badge_${joint}`);

    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        state.armAngles[joint] = val;
        state.targetAngles[joint] = val;
        state.activeJoint = joint;
        if (badge) badge.textContent = `${val}°`;
        syncArmAngles(joint);
      });
    }
  });

  // Nudge Buttons ([-5°], [Ideal/Center], [+5°])
  document.querySelectorAll('.nudge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const joint = btn.getAttribute('data-joint');
      const isCenter = btn.getAttribute('data-center') === 'true';
      const delta = parseInt(btn.getAttribute('data-delta'), 10) || 0;
      const jConfig = config.armJoints[joint];

      if (!jConfig) return;

      let newAngle = state.armAngles[joint];

      if (isCenter) {
        newAngle = jConfig.ideal;
      } else {
        newAngle = Math.max(jConfig.min, Math.min(jConfig.max, newAngle + delta));
      }

      state.armAngles[joint] = newAngle;
      state.targetAngles[joint] = newAngle;

      const slider = document.getElementById(`slider_${joint}`);
      const badge = document.getElementById(`badge_${joint}`);

      if (slider) slider.value = newAngle;
      if (badge) badge.textContent = `${newAngle}°`;

      sfx.playClick();
      syncArmAngles(joint);
    });
  });

  // Preset Buttons (Pick, Pos1, Pos2, Pos3, Drop, Idle)
  dom.presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const presetId = btn.getAttribute('data-preset');
      btn.classList.add('active');
      setTimeout(() => btn.classList.remove('active'), 350);
      applyPosePreset(presetId);
    });
  });
}

/**
 * Bind Rover RC D-Pad & Controls
 */
function bindRoverEvents() {
  dom.dpadButtons.forEach(btn => {
    const cmd = btn.getAttribute('data-cmd');

    btn.addEventListener('mousedown', () => {
      btn.classList.add('pressed');
      executeRoverCommand(cmd);
    });

    btn.addEventListener('mouseup', () => {
      btn.classList.remove('pressed');
      if (config.rover.autoBrakeOnRelease && cmd !== 'ROVER_STOP') {
        executeRoverCommand('ROVER_STOP');
      }
    });

    btn.addEventListener('mouseleave', () => {
      if (btn.classList.contains('pressed')) {
        btn.classList.remove('pressed');
        if (config.rover.autoBrakeOnRelease && cmd !== 'ROVER_STOP') {
          executeRoverCommand('ROVER_STOP');
        }
      }
    });

    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      executeRoverCommand(cmd);
    });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      btn.classList.remove('pressed');
      if (config.rover.autoBrakeOnRelease && cmd !== 'ROVER_STOP') {
        executeRoverCommand('ROVER_STOP');
      }
    });
  });

  // Speed Mode Selector
  dom.speedPills.forEach(pill => {
    pill.addEventListener('click', () => {
      dom.speedPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const spd = parseInt(pill.getAttribute('data-speed'), 10) || 70;
      state.roverSpeed = spd;
      sfx.playClick();
      logEvent('system', `Rover speed set to: ${spd}%`);
    });
  });

  // Aux Lights
  dom.btnRoverLights?.addEventListener('click', () => {
    state.lightsOn = !state.lightsOn;
    dom.btnRoverLights.classList.toggle('active', state.lightsOn);
    const cmd = state.lightsOn ? 'ROVER_LIGHTS_ON' : 'ROVER_LIGHTS_OFF';
    executeRoverCommand(cmd);
  });

  // Aux Horn
  dom.btnRoverHorn?.addEventListener('mousedown', () => {
    dom.btnRoverHorn.classList.add('active');
    executeRoverCommand('ROVER_HORN');
  });
  dom.btnRoverHorn?.addEventListener('mouseup', () => {
    dom.btnRoverHorn.classList.remove('active');
  });
}

function executeRoverCommand(cmd) {
  if (cmd === 'ROVER_STOP') {
    sfx.playStop();
  } else {
    sfx.playDrive();
  }
  sendCommand(cmd, { speed: state.roverSpeed });
}

/**
 * Keyboard Teleoperation Controls
 */
function bindKeyboardEvents() {
  const keyMap = {
    'KeyW': 'ROVER_FWD',
    'ArrowUp': 'ROVER_FWD',
    'KeyS': 'ROVER_REV',
    'ArrowDown': 'ROVER_REV',
    'KeyA': 'ROVER_LEFT',
    'ArrowLeft': 'ROVER_LEFT',
    'KeyD': 'ROVER_RIGHT',
    'ArrowRight': 'ROVER_RIGHT',
    'KeyQ': 'ROVER_SPIN_L',
    'KeyE': 'ROVER_SPIN_R',
    'Space': 'ROVER_STOP'
  };

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      if (document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
      }
    }

    if (document.activeElement.tagName === 'INPUT') return;

    const cmd = keyMap[e.code];
    if (cmd && !state.activeKeys.has(e.code)) {
      state.activeKeys.add(e.code);
      executeRoverCommand(cmd);
    }
  });

  window.addEventListener('keyup', (e) => {
    if (document.activeElement.tagName === 'INPUT') return;

    const cmd = keyMap[e.code];
    if (cmd) {
      state.activeKeys.delete(e.code);
      if (state.activeKeys.size === 0 && config.rover.autoBrakeOnRelease) {
        executeRoverCommand('ROVER_STOP');
      }
    }
  });
}

/**
 * Keyboard Shortcuts Modal Dialog Handler (Requested Popup)
 */
function bindModalEvents() {
  const modal = dom.keyboardModal;
  if (!modal) return;

  dom.btnOpenKeyModal?.addEventListener('click', () => {
    modal.classList.remove('hidden');
    sfx.playClick();
  });

  dom.btnCloseKeyModal?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  dom.btnOkKeyModal?.addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  // Close when clicking outside card
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
    }
  });

  // Close on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
    }
  });
}

/**
 * Terminal Event Log
 */
function logEvent(type, message) {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${time}] ${message}`;

  if (dom.terminalLog) {
    dom.terminalLog.prepend(entry);
    if (dom.terminalLog.children.length > 80) {
      dom.terminalLog.removeChild(dom.terminalLog.lastChild);
    }
  }
}

function bindTerminalEvents() {
  dom.btnToggleTerminal?.addEventListener('click', () => {
    dom.terminalDrawer.classList.toggle('hidden');
    const isHidden = dom.terminalDrawer.classList.contains('hidden');
    dom.btnToggleTerminal.innerHTML = isHidden ? 'Show Terminal &blacktriangledown;' : 'Hide Terminal &blacktriangle;';
  });

  dom.btnClearLog?.addEventListener('click', () => {
    if (dom.terminalLog) dom.terminalLog.innerHTML = '';
  });
}

function updateMissionClock() {
  const elapsedSec = Math.floor((Date.now() - state.missionStartTime) / 1000);
  const hrs = String(Math.floor(elapsedSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0');
  const secs = String(elapsedSec % 60).padStart(2, '0');

  if (dom.feedbackUptime) {
    dom.feedbackUptime.textContent = `${hrs}:${mins}:${secs}`;
  }
}

// Boot application when DOM is ready
document.addEventListener('DOMContentLoaded', init);
