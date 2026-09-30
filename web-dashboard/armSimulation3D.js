/**
 * ==========================================================================
 * Realistic 3D Robotic Arm Kinematics Simulator (Three.js)
 * Model matches physical blue & white 5-DOF arm with 4-direction support legs
 * ==========================================================================
 */

export class ArmSimulation3D {
  constructor(containerElement) {
    this.container = containerElement;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.animId = null;

    // Joint hierarchical groups
    this.groups = {
      baseTurret: null,
      shoulder: null,
      elbow: null,
      wrist: null,
      gripperLeft: null,
      gripperRight: null,
      endEffector: null
    };

    // Color theme matching the user's physical robot arm image
    this.colors = {
      bluePlastic: 0x0284c7,     // Vibrant royal/electric blue
      blueAccent: 0x0369a1,      // Deep blue
      whitePlastic: 0xf8fafc,    // Clean 3D-printed white
      servoBlue: 0x1d4ed8,       // SG90 micro-servo casing
      brassPin: 0xf59e0b,        // Brass gear / screws
      darkScrew: 0x334155,       // Screw heads
      wireBrown: 0x78350f,
      wireRed: 0xdc2626,
      wireYellow: 0xfacc15
    };

    this.currentAngles = {
      base: 90,
      shoulder: 90,
      elbow: 90,
      wrist: 90,
      gripper: 80
    };

    this.init();
  }

  init() {
    if (!this.container) return;

    const width = this.container.clientWidth || 500;
    const height = this.container.clientHeight || 340;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a101d);

    // 2. Camera
    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
    this.camera.position.set(28, 26, 32);

    // 3. Renderer with antialiasing and shadow maps
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.appendChild(this.renderer.domElement);

    // 4. Orbit Controls (Drag to rotate, scroll to zoom, right-click to pan)
    if (window.THREE && THREE.OrbitControls) {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.target.set(0, 8, 0);
      this.controls.maxPolarAngle = Math.PI / 2 + 0.05; // Don't go below floor
      this.controls.minDistance = 12;
      this.controls.maxDistance = 75;
    }

    // 5. Lighting Setup
    this.setupLighting();

    // 6. Ground & Workcell Calibration Plane
    this.setupGround();

    // 7. Build Realistic 3D Robot Arm (Matching User's Image)
    this.buildArmModel();

    // 8. Resize Observer
    this.setupResize();

    // 9. Animation Loop
    this.animate = this.animate.bind(this);
    this.animate();
  }

  setupLighting() {
    // Soft Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambientLight);

    // Key Directional Sun Light (Casts soft shadows)
    const sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
    sunLight.position.set(20, 40, 25);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    sunLight.shadow.camera.left = -20;
    sunLight.shadow.camera.right = 20;
    sunLight.shadow.camera.top = 20;
    sunLight.shadow.camera.bottom = -20;
    sunLight.shadow.bias = -0.0005;
    this.scene.add(sunLight);

    // Fill Rim Light (Cyan tint for high-tech robotics feel)
    const rimLight = new THREE.DirectionalLight(0x00d2ff, 0.4);
    rimLight.position.set(-25, 20, -20);
    this.scene.add(rimLight);
  }

  setupGround() {
    // Circular workcell platform
    const platformGeo = new THREE.CylinderGeometry(18, 18.5, 0.5, 48);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x111c2e,
      roughness: 0.7,
      metalness: 0.2
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.25;
    platform.receiveShadow = true;
    this.scene.add(platform);

    // Subtle grid helper
    const grid = new THREE.GridHelper(34, 18, 0x00d2ff, 0x1e293b);
    grid.position.y = 0.01;
    this.scene.add(grid);

    // Workpiece Target Box on Table
    const boxGeo = new THREE.BoxGeometry(2.2, 2.2, 2.2);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.4,
      metalness: 0.3
    });
    this.targetBox = new THREE.Mesh(boxGeo, boxMat);
    this.targetBox.position.set(10, 1.1, 8);
    this.targetBox.castShadow = true;
    this.targetBox.receiveShadow = true;
    this.scene.add(this.targetBox);
  }

  /**
   * Build 3D Model specifically matching the user's photo:
   * White base cylinder + 4 Outrigger Support Legs + Blue turntable +
   * Blue bicep/boom + Blue forearm + White wrist & claw jaws + Blue SG90 micro-servos!
   */
  buildArmModel() {
    const blueMat = new THREE.MeshStandardMaterial({
      color: this.colors.bluePlastic,
      roughness: 0.35,
      metalness: 0.1
    });

    const whiteMat = new THREE.MeshStandardMaterial({
      color: this.colors.whitePlastic,
      roughness: 0.3,
      metalness: 0.05
    });

    const servoMat = new THREE.MeshStandardMaterial({
      color: this.colors.servoBlue,
      roughness: 0.2,
      metalness: 0.3,
      transparent: true,
      opacity: 0.92
    });

    const brassMat = new THREE.MeshStandardMaterial({
      color: this.colors.brassPin,
      roughness: 0.3,
      metalness: 0.8
    });

    // ==========================================
    // 1. FIXED BASE ASSEMBLY (Floor Level)
    // ==========================================
    const baseFixedGroup = new THREE.Group();
    this.scene.add(baseFixedGroup);

    // White Cylindrical Base Pedestal
    const baseCylGeo = new THREE.CylinderGeometry(3.6, 3.8, 3.5, 32);
    const baseCyl = new THREE.Mesh(baseCylGeo, whiteMat);
    baseCyl.position.y = 1.75;
    baseCyl.castShadow = true;
    baseCyl.receiveShadow = true;
    baseFixedGroup.add(baseCyl);

    // Base bottom rim flange
    const baseFlangeGeo = new THREE.CylinderGeometry(4.2, 4.4, 0.4, 32);
    const baseFlange = new THREE.Mesh(baseFlangeGeo, whiteMat);
    baseFlange.position.y = 0.2;
    baseFlange.castShadow = true;
    baseFlange.receiveShadow = true;
    baseFixedGroup.add(baseFlange);

    // 4 OUTRIGGER STABILIZER SUPPORT LEGS (Exactly as in the image!)
    for (let i = 0; i < 4; i++) {
      const legAngle = (i * Math.PI) / 2 + Math.PI / 4;
      const legGroup = new THREE.Group();
      legGroup.rotation.y = legAngle;

      // Slanted tapered blue leg
      const legGeo = new THREE.BoxGeometry(1.4, 0.45, 6.2);
      const leg = new THREE.Mesh(legGeo, blueMat);
      leg.position.set(0, 0.22, 5.2);
      leg.rotation.x = -0.06; // slight downward taper
      leg.castShadow = true;
      leg.receiveShadow = true;
      legGroup.add(leg);

      // Leg foot pad
      const footGeo = new THREE.BoxGeometry(1.6, 0.3, 1.2);
      const foot = new THREE.Mesh(footGeo, blueMat);
      foot.position.set(0, 0.15, 8.2);
      foot.castShadow = true;
      legGroup.add(foot);

      baseFixedGroup.add(legGroup);
    }

    // Black USB/Power port cutout on white base
    const portGeo = new THREE.BoxGeometry(0.8, 0.5, 0.4);
    const portMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    const port = new THREE.Mesh(portGeo, portMat);
    port.position.set(0, 1.0, 3.7);
    baseFixedGroup.add(port);

    // ==========================================
    // 2. J1: BASE ROTATING TURNTABLE (YAW)
    // ==========================================
    this.groups.baseTurret = new THREE.Group();
    this.groups.baseTurret.position.set(0, 3.5, 0); // At top of white base
    this.scene.add(this.groups.baseTurret);

    // Blue turntable cap ring
    const turnTopGeo = new THREE.CylinderGeometry(3.6, 3.6, 0.8, 32);
    const turnTop = new THREE.Mesh(turnTopGeo, blueMat);
    turnTop.position.y = 0.4;
    turnTop.castShadow = true;
    this.groups.baseTurret.add(turnTop);

    // Dual vertical blue pivot brackets (hold the shoulder servo)
    const bracketGeo = new THREE.BoxGeometry(0.5, 3.2, 2.6);
    const leftBracket = new THREE.Mesh(bracketGeo, blueMat);
    leftBracket.position.set(-1.4, 2.2, 0);
    leftBracket.castShadow = true;
    this.groups.baseTurret.add(leftBracket);

    const rightBracket = new THREE.Mesh(bracketGeo, blueMat);
    rightBracket.position.set(1.4, 2.2, 0);
    rightBracket.castShadow = true;
    this.groups.baseTurret.add(rightBracket);

    // Circular shoulder actuator disc on bracket side
    const discGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.4, 24);
    discGeo.rotateZ(Math.PI / 2);
    const disc = new THREE.Mesh(discGeo, blueMat);
    disc.position.set(1.7, 3.0, 0);
    disc.castShadow = true;
    this.groups.baseTurret.add(disc);

    // ==========================================
    // 3. J2: SHOULDER JOINT & LOWER BOOM LINK
    // ==========================================
    this.groups.shoulder = new THREE.Group();
    this.groups.shoulder.position.set(0, 3.0, 0); // Shoulder pivot axis
    this.groups.baseTurret.add(this.groups.shoulder);

    // Blue Main Boom Arm (Bicep Link)
    const boomGeo = new THREE.BoxGeometry(1.8, 8.5, 1.2);
    const boomMesh = new THREE.Mesh(boomGeo, blueMat);
    boomMesh.position.set(0, 4.25, 0);
    boomMesh.castShadow = true;
    this.groups.shoulder.add(boomMesh);

    // Servo detail mounted on shoulder
    const servoBoxGeo = new THREE.BoxGeometry(1.2, 2.3, 1.1);
    const servoMesh = new THREE.Mesh(servoBoxGeo, servoMat);
    servoMesh.position.set(1.1, 2.0, 0);
    this.groups.shoulder.add(servoMesh);

    // Decorative ribbon cable on side of boom (Brown/Red/Yellow wires)
    const wireGeo = new THREE.CylinderGeometry(0.08, 0.08, 8.0, 8);
    const wireMat1 = new THREE.MeshBasicMaterial({ color: this.colors.wireBrown });
    const wireMat2 = new THREE.MeshBasicMaterial({ color: this.colors.wireRed });
    const wireMat3 = new THREE.MeshBasicMaterial({ color: this.colors.wireYellow });

    const w1 = new THREE.Mesh(wireGeo, wireMat1);
    w1.position.set(-1.0, 4.2, -0.2);
    const w2 = new THREE.Mesh(wireGeo, wireMat2);
    w2.position.set(-1.0, 4.2, 0);
    const w3 = new THREE.Mesh(wireGeo, wireMat3);
    w3.position.set(-1.0, 4.2, 0.2);
    this.groups.shoulder.add(w1, w2, w3);

    // ==========================================
    // 4. J3: ELBOW JOINT & FOREARM LINK
    // ==========================================
    this.groups.elbow = new THREE.Group();
    this.groups.elbow.position.set(0, 8.5, 0); // Elbow pivot at top of boom
    this.groups.shoulder.add(this.groups.elbow);

    // Elbow circular actuator hub
    const elbowDiscGeo = new THREE.CylinderGeometry(1.4, 1.4, 2.2, 24);
    elbowDiscGeo.rotateZ(Math.PI / 2);
    const elbowDisc = new THREE.Mesh(elbowDiscGeo, blueMat);
    elbowDisc.castShadow = true;
    this.groups.elbow.add(elbowDisc);

    // Forearm Blue Link
    const forearmGeo = new THREE.BoxGeometry(1.5, 7.5, 1.0);
    const forearmMesh = new THREE.Mesh(forearmGeo, blueMat);
    forearmMesh.position.set(0, 3.75, 0);
    forearmMesh.castShadow = true;
    this.groups.elbow.add(forearmMesh);

    // White Clevis Bracket at end of forearm (Matches photo!)
    const clevisGeo = new THREE.BoxGeometry(1.9, 1.8, 1.3);
    const clevisMesh = new THREE.Mesh(clevisGeo, whiteMat);
    clevisMesh.position.set(0, 7.2, 0);
    clevisMesh.castShadow = true;
    this.groups.elbow.add(clevisMesh);

    // ==========================================
    // 5. J4: WRIST JOINT & SERVO FLANGE
    // ==========================================
    this.groups.wrist = new THREE.Group();
    this.groups.wrist.position.set(0, 7.5, 0); // Wrist pivot axis
    this.groups.elbow.add(this.groups.wrist);

    // White Wrist Mount Bracket
    const wristBracketGeo = new THREE.BoxGeometry(2.4, 1.5, 1.8);
    const wristBracket = new THREE.Mesh(wristBracketGeo, whiteMat);
    wristBracket.position.set(0, 0.8, 0);
    wristBracket.castShadow = true;
    this.groups.wrist.add(wristBracket);

    // Blue SG90 Micro Servo (Attached horizontally facing gripper)
    const wristServoGeo = new THREE.BoxGeometry(1.2, 2.2, 1.2);
    const wristServo = new THREE.Mesh(wristServoGeo, servoMat);
    wristServo.position.set(0, 2.0, 0);
    this.groups.wrist.add(wristServo);

    // Brass servo horn pin
    const hornGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.4, 12);
    const horn = new THREE.Mesh(hornGeo, brassMat);
    horn.position.set(0, 3.2, 0);
    this.groups.wrist.add(horn);

    // ==========================================
    // 6. J5: GRIPPER CLAW MECHANISM
    // ==========================================
    const gripperBaseGroup = new THREE.Group();
    gripperBaseGroup.position.set(0, 3.2, 0);
    this.groups.wrist.add(gripperBaseGroup);

    // White Base Gripper Plate
    const plateGeo = new THREE.BoxGeometry(3.6, 0.4, 1.8);
    const plate = new THREE.Mesh(plateGeo, whiteMat);
    plate.position.set(0, 0.2, 0);
    plate.castShadow = true;
    gripperBaseGroup.add(plate);

    // Metal Standoff Posts (Visible in photo!)
    const standoffGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.2, 12);
    const standoffMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.2 });

    const post1 = new THREE.Mesh(standoffGeo, standoffMat);
    post1.position.set(-1.2, 0.8, 0.5);
    const post2 = new THREE.Mesh(standoffGeo, standoffMat);
    post2.position.set(1.2, 0.8, 0.5);
    gripperBaseGroup.add(post1, post2);

    // LEFT ARTICULATED CLAW JAW (White)
    this.groups.gripperLeft = new THREE.Group();
    this.groups.gripperLeft.position.set(-1.2, 0.4, 0);
    gripperBaseGroup.add(this.groups.gripperLeft);

    const jawGeoL = new THREE.BoxGeometry(0.4, 3.4, 0.8);
    const jawMeshL = new THREE.Mesh(jawGeoL, whiteMat);
    jawMeshL.position.set(0, 1.7, 0);
    jawMeshL.castShadow = true;
    this.groups.gripperLeft.add(jawMeshL);

    // Claw tip angle pad
    const tipGeoL = new THREE.BoxGeometry(0.8, 0.4, 0.8);
    const tipMeshL = new THREE.Mesh(tipGeoL, whiteMat);
    tipMeshL.position.set(0.3, 3.4, 0);
    this.groups.gripperLeft.add(tipMeshL);

    // RIGHT ARTICULATED CLAW JAW (White)
    this.groups.gripperRight = new THREE.Group();
    this.groups.gripperRight.position.set(1.2, 0.4, 0);
    gripperBaseGroup.add(this.groups.gripperRight);

    const jawGeoR = new THREE.BoxGeometry(0.4, 3.4, 0.8);
    const jawMeshR = new THREE.Mesh(jawGeoR, whiteMat);
    jawMeshR.position.set(0, 1.7, 0);
    jawMeshR.castShadow = true;
    this.groups.gripperRight.add(jawMeshR);

    const tipGeoR = new THREE.BoxGeometry(0.8, 0.4, 0.8);
    const tipMeshR = new THREE.Mesh(tipGeoR, whiteMat);
    tipMeshR.position.set(-0.3, 3.4, 0);
    this.groups.gripperRight.add(tipMeshR);

    // End-Effector reference point
    this.groups.endEffector = new THREE.Group();
    this.groups.endEffector.position.set(0, 3.6, 0);
    gripperBaseGroup.add(this.groups.endEffector);

    // Initial pose alignment
    this.setAngles(this.currentAngles);
  }

  /**
   * Update 3D Arm Joint Angles in Degrees
   * @param {object} angles - { base, shoulder, elbow, wrist, gripper }
   */
  setAngles(angles) {
    if (!angles) return;
    Object.assign(this.currentAngles, angles);

    const { base, shoulder, elbow, wrist, gripper } = this.currentAngles;

    // 1. Base (Yaw): Rotates around Y-axis (0° - 180°, centered at 90°)
    if (this.groups.baseTurret) {
      const baseRad = -((base - 90) * Math.PI) / 180;
      this.groups.baseTurret.rotation.y = baseRad;
    }

    // 2. Shoulder (Pitch): Rotates around Z-axis (15° - 165°, centered at 90°)
    if (this.groups.shoulder) {
      const shoulderRad = ((shoulder - 90) * Math.PI) / 180;
      this.groups.shoulder.rotation.z = shoulderRad;
    }

    // 3. Elbow (Pitch): Rotates relative to shoulder (0° - 180°, centered at 90°)
    if (this.groups.elbow) {
      const elbowRad = -((elbow - 90) * Math.PI) / 180;
      this.groups.elbow.rotation.z = elbowRad;
    }

    // 4. Wrist (Pitch): Rotates relative to forearm
    if (this.groups.wrist) {
      const wristRad = -((wrist - 90) * Math.PI) / 180;
      this.groups.wrist.rotation.z = wristRad;
    }

    // 5. Gripper (Claw Aperture): 20° (closed clamp) to 140° (open wide)
    if (this.groups.gripperLeft && this.groups.gripperRight) {
      // Map gripper angle to jaw rotation spread (0 to ~0.55 radians)
      const norm = Math.max(0, Math.min(1, (gripper - 20) / (140 - 20)));
      const jawSpreadRad = norm * 0.45;

      this.groups.gripperLeft.rotation.z = jawSpreadRad;
      this.groups.gripperRight.rotation.z = -jawSpreadRad;
    }
  }

  /**
   * Calculate World Coordinates of End-Effector Tip
   */
  getEndEffectorWorldPos() {
    if (!this.groups.endEffector) return { x: 0, y: 0, z: 0 };
    const target = new THREE.Vector3();
    this.groups.endEffector.getWorldPosition(target);
    return {
      x: Math.round(target.x * 15),
      y: Math.round(target.y * 15),
      z: Math.round(target.z * 15)
    };
  }

  resetView() {
    if (this.camera && this.controls) {
      this.camera.position.set(28, 26, 32);
      this.controls.target.set(0, 8, 0);
      this.controls.update();
    }
  }

  setupResize() {
    const handleResize = () => {
      if (!this.container || !this.renderer || !this.camera) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (width && height) {
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
      }
    };

    window.addEventListener('resize', handleResize);
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(handleResize);
      ro.observe(this.container);
    }
  }

  animate() {
    this.animId = requestAnimationFrame(this.animate);
    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy() {
    if (this.animId) cancelAnimationFrame(this.animId);
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.remove();
    }
  }
}
