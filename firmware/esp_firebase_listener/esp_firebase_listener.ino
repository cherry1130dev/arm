/**
 * ======================================================================================
 * Project: IoT Test-Bench Microcontroller Node (Firebase RTDB Listener)
 * Supported Boards: ESP32 (NodeMCU-32S, ESP-WROOM-32) & ESP8266 (NodeMCU, Wemos D1 Mini)
 * 
 * Library Required: "Firebase Arduino Client Library for ESP8266 and ESP32" by Mobizt
 * Install via Arduino IDE: Tools -> Manage Libraries -> Search "Firebase ESP Client" -> Install
 * 
 * Functionality:
 * 1. Connects to 2.4GHz Wi-Fi with auto-reconnect.
 * 2. Connects to Firebase Realtime Database using non-blocking stream callback.
 * 3. Instantly intercepts changes to "/test_bench/command" and "/test_bench/servo_angle".
 * 4. Prints incoming commands clearly to Serial Monitor (115200 baud).
 * 5. Sends acknowledgment back to "/test_bench/device_ack" for two-way roundtrip verification.
 * ======================================================================================
 */

#if defined(ESP32)
  #include <WiFi.h>
#elif defined(ESP8266)
  #include <ESP8266WiFi.h>
#endif

#include <Firebase_ESP_Client.h>

// Provide the RTDB payload parsing helpers
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

// ======================================================================================
// CONFIGURATION: Set your Wi-Fi and Firebase Credentials
// ======================================================================================
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

// Firebase project credentials (found in Firebase Console -> Project Settings)
#define API_KEY         "YOUR_FIREBASE_WEB_API_KEY"

// Firebase Realtime Database URL (MUST include https:// and end with firebaseio.com or firebasedatabase.app)
#define DATABASE_URL    "https://YOUR-PROJECT-ID-default-rtdb.firebaseio.com"

// ======================================================================================
// Global Objects
// ======================================================================================
FirebaseData fbdoStream;   // Dedicated FirebaseData object for incoming real-time stream
FirebaseData fbdoWriter;   // Dedicated FirebaseData object for outgoing responses / acknowledgments
FirebaseAuth auth;
FirebaseConfig config;

unsigned long lastHeartbeat = 0;
const unsigned long HEARTBEAT_INTERVAL = 30000; // Send heartbeat ping every 30 seconds

// ======================================================================================
// Stream Event Callback (Triggers instantly when data in "/test_bench" changes)
// Forward declarations
void handleCommand(const String& cmd);
void handleServoAngle(int angle);
void handleArmAngles(int base, int shoulder, int elbow, int wrist, int gripper);
void sendAck(const String& message);

// ======================================================================================
// Stream Event Callback (Triggers instantly when data in "/test_bench" changes)
// ======================================================================================
void streamCallback(FirebaseStream data) {
  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F(">>> [FIREBASE RTDB STREAM EVENT INTERCEPTED] <<<"));
  Serial.printf("Path: %s\n", data.dataPath().c_str());
  Serial.printf("Data Type: %s\n", data.dataType().c_str());

  String eventPath = data.dataPath();

  // 1. Case: Direct update to "/command" or full object update containing "command"
  if (eventPath == "/command" || eventPath == "/") {
    if (data.dataType() == "string") {
      String cmd = data.stringData();
      Serial.printf(">> [COMMAND RECEIVED]: %s\n", cmd.c_str());
      handleCommand(cmd);
    } 
    else if (data.dataType() == "json") {
      FirebaseJson &json = data.jsonObject();
      FirebaseJsonData jsonData;
      if (json.get(jsonData, "command")) {
        Serial.printf(">> [COMMAND RECEIVED via JSON]: %s\n", jsonData.stringValue.c_str());
        handleCommand(jsonData.stringValue);
      }
      if (json.get(jsonData, "servo_angle")) {
        int angle = jsonData.intValue;
        Serial.printf(">> [SERVO ANGLE via JSON]: %d deg\n", angle);
        handleServoAngle(angle);
      }
      // Check for multi-joint arm_angles
      if (json.get(jsonData, "arm_angles")) {
        FirebaseJson armJson;
        jsonData.get<FirebaseJson>(armJson);
        FirebaseJsonData jData;
        int b = 90, s = 90, el = 90, w = 90, g = 80;
        if (armJson.get(jData, "base")) b = jData.intValue;
        if (armJson.get(jData, "shoulder")) s = jData.intValue;
        if (armJson.get(jData, "elbow")) el = jData.intValue;
        if (armJson.get(jData, "wrist")) w = jData.intValue;
        if (armJson.get(jData, "gripper")) g = jData.intValue;
        handleArmAngles(b, s, el, w, g);
      }
    }
  }

  // 2. Case: Direct update to "/arm_angles"
  if (eventPath == "/arm_angles") {
    if (data.dataType() == "json") {
      FirebaseJson &armJson = data.jsonObject();
      FirebaseJsonData jData;
      int b = 90, s = 90, el = 90, w = 90, g = 80;
      if (armJson.get(jData, "base")) b = jData.intValue;
      if (armJson.get(jData, "shoulder")) s = jData.intValue;
      if (armJson.get(jData, "elbow")) el = jData.intValue;
      if (armJson.get(jData, "wrist")) w = jData.intValue;
      if (armJson.get(jData, "gripper")) g = jData.intValue;
      handleArmAngles(b, s, el, w, g);
    }
  }

  // 3. Case: Direct update to "/servo_angle"
  if (eventPath == "/servo_angle") {
    if (data.dataType() == "int" || data.dataType() == "float") {
      int angle = data.intData();
      Serial.printf(">> [SERVO ANGLE RECEIVED]: %d deg\n", angle);
      handleServoAngle(angle);
    }
  }

  Serial.println(F("=================================================="));
}

// Stream Timeout Callback
void streamTimeoutCallback(bool timeout) {
  if (timeout) {
    Serial.println(F("[STREAM] Stream timeout occurred, resuming..."));
  }
}

// ======================================================================================
// Hardware Command Actions
// ======================================================================================
void handleCommand(const String& cmd) {
  Serial.println(F("--------------------------------------------------"));
  Serial.printf("[ACTION EXECUTOR] Executing: [%s]\n", cmd.c_str());

  // --- ARM PRESETS (Unique Command Strings) ---
  if (cmd == "pic") {
    Serial.println(F("  -> [ARM POSE: PICK] Descending to grasp target at ground coordinates"));
  } else if (cmd == "drop") {
    Serial.println(F("  -> [ARM POSE: DROP] Releasing payload at designated receptacle"));
  } else if (cmd == "pos1") {
    Serial.println(F("  -> [ARM POSE: POS 1] Moving to Left Quadrant Inspection Waypoint"));
  } else if (cmd == "pos2") {
    Serial.println(F("  -> [ARM POSE: POS 2] Moving to High Elevation Observation Waypoint"));
  } else if (cmd == "pos3") {
    Serial.println(F("  -> [ARM POSE: POS 3] Moving to Right Delivery Quadrant Waypoint"));
  } else if (cmd == "idle") {
    Serial.println(F("  -> [ARM POSE: IDLE] Stowing 5-axis arm to safe travel center balance"));
  } 
  // --- ROVER RC CONTROLS ---
  else if (cmd == "ROVER_FWD") {
    Serial.println(F("  -> [ROVER] Forward Drive: MOTORS_FWD = ACTIVE"));
  } else if (cmd == "ROVER_REV") {
    Serial.println(F("  -> [ROVER] Reverse Drive: MOTORS_REV = ACTIVE"));
  } else if (cmd == "ROVER_LEFT") {
    Serial.println(F("  -> [ROVER] Steer Left: DIFFERENTIAL_STEER_LEFT = ACTIVE"));
  } else if (cmd == "ROVER_RIGHT") {
    Serial.println(F("  -> [ROVER] Steer Right: DIFFERENTIAL_STEER_RIGHT = ACTIVE"));
  } else if (cmd == "ROVER_STOP") {
    Serial.println(F("  -> [ROVER] E-Brake / Stop: MOTORS_ALL = INACTIVE (HOLD)"));
  } else if (cmd == "ROVER_SPIN_L") {
    Serial.println(F("  -> [ROVER] Pivot Spin Left: TANK_SPIN_CCW = ACTIVE"));
  } else if (cmd == "ROVER_SPIN_R") {
    Serial.println(F("  -> [ROVER] Pivot Spin Right: TANK_SPIN_CW = ACTIVE"));
  } else if (cmd == "ROVER_LIGHTS_ON") {
    Serial.println(F("  -> [PAYLOAD] Headlights: ON (HIGH-BEAM)"));
  } else if (cmd == "ROVER_LIGHTS_OFF") {
    Serial.println(F("  -> [PAYLOAD] Headlights: OFF"));
  } else if (cmd == "ROVER_HORN") {
    Serial.println(F("  -> [PAYLOAD] Horn/Buzzer Triggered!"));
  } 
  // --- LEGACY COMMANDS ---
  else if (cmd == "Motor Forward") {
    Serial.println(F("  -> Pin Trigger: MOTOR_IN1 = HIGH, MOTOR_IN2 = LOW"));
  } else if (cmd == "Motor Reverse") {
    Serial.println(F("  -> Pin Trigger: MOTOR_IN1 = LOW, MOTOR_IN2 = HIGH"));
  } else if (cmd == "Motor Stop") {
    Serial.println(F("  -> Pin Trigger: MOTOR_IN1 = LOW, MOTOR_IN2 = LOW (STOP)"));
  } else {
    Serial.printf("  -> Custom payload detected: %s\n", cmd.c_str());
  }

  // Send visual acknowledgment back to Firebase so the Web Dashboard confirms round-trip loop
  sendAck("ACK: " + cmd + " @ " + String(millis()) + "ms");
  Serial.println(F("--------------------------------------------------"));
}

void handleArmAngles(int base, int shoulder, int elbow, int wrist, int gripper) {
  base = constrain(base, 0, 180);
  shoulder = constrain(shoulder, 0, 180);
  elbow = constrain(elbow, 0, 180);
  wrist = constrain(wrist, 0, 180);
  gripper = constrain(gripper, 0, 180);

  Serial.println(F("[5-DOF ARM SERVO CONTROLLER] Synchronizing Joint Angles:"));
  Serial.printf("  - J1 Base Turret:     %d deg\n", base);
  Serial.printf("  - J2 Shoulder Boom:   %d deg\n", shoulder);
  Serial.printf("  - J3 Elbow Artic.:    %d deg\n", elbow);
  Serial.printf("  - J4 Wrist Tool:      %d deg\n", wrist);
  Serial.printf("  - J5 Gripper Claw:    %d deg\n", gripper);

  // In physical hardware, write to PCA9685 PWM or Servo library:
  // servoBase.write(base);
  // servoShoulder.write(shoulder);
  // servoElbow.write(elbow);
  // servoWrist.write(wrist);
  // servoGripper.write(gripper);

  sendAck("ACK: Arm J1=" + String(base) + " J2=" + String(shoulder) + " J3=" + String(elbow) + " J4=" + String(wrist) + " J5=" + String(gripper));
}

void handleServoAngle(int angle) {
  // Constrain between 0 and 180 degrees
  angle = constrain(angle, 0, 180);
  Serial.printf("[SERVO CONTROLLER] Target Angle Set to: %d degrees\n", angle);
  
  // (In real hardware setup, call: myServo.write(angle);)
  
  // Acknowledge back to Firebase
  sendAck("ACK: Angle " + String(angle) + " deg");
}

void sendAck(const String& message) {
  if (!Firebase.ready()) return;

  FirebaseJson ackJson;
  ackJson.set("status", message);
  ackJson.set("device_uptime_ms", millis());

  // Non-blocking asynchronous update to /test_bench/device_ack
  if (Firebase.RTDB.setJSON(&fbdoWriter, "/test_bench/device_ack", &ackJson)) {
    Serial.printf("[ACK SENT] %s\n", message.c_str());
  } else {
    Serial.printf("[ACK FAILED] Reason: %s\n", fbdoWriter.errorReason().c_str());
  }
}

// ======================================================================================
// Setup
// ======================================================================================
void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println(F("##################################################"));
  Serial.println(F("#      ESP IoT Test-Bench Firebase Listener      #"));
  Serial.println(F("##################################################"));

  // 1. Connect to Wi-Fi
  Serial.printf("Connecting to Wi-Fi SSID: %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println(F("[WIFI] Connected Successfully!"));
  Serial.print(F("[WIFI] Node IP Address: "));
  Serial.println(WiFi.localIP());
  Serial.print(F("[WIFI] Signal Strength (RSSI): "));
  Serial.print(WiFi.RSSI());
  Serial.println(F(" dBm"));

  // 2. Configure Firebase Client
  Serial.println(F("\n[FIREBASE] Initializing Firebase RTDB Client..."));
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  // Sign up as anonymous / unauthenticated (or supply token if auth is enabled)
  auth.user.email = "";
  auth.user.password = "";

  // Assign reconnect options
  Firebase.reconnectWiFi(true);
  fbdoStream.setResponseSize(2048);

  Firebase.begin(&config, &auth);

  // 3. Initiate Non-Blocking Stream on /test_bench
  Serial.println(F("[FIREBASE] Attaching real-time stream listener on path: /test_bench"));
  if (!Firebase.RTDB.beginStream(&fbdoStream, "/test_bench")) {
    Serial.printf("[FIREBASE STREAM ERROR] Reason: %s\n", fbdoStream.errorReason().c_str());
  } else {
    Serial.println(F("[FIREBASE STREAM] Stream initialized successfully!"));
  }

  // Register callback functions
  Firebase.RTDB.setStreamCallback(&fbdoStream, streamCallback, streamTimeoutCallback);

  // Send initial boot-up message to Firebase
  sendAck("ESP Node Online (" + WiFi.localIP().toString() + ")");
}

// ======================================================================================
// Loop
// ======================================================================================
void loop() {
  // Keep Firebase connection alive and process background tasks
  // Firebase.ready() returns true when authentication and connection are valid
  if (Firebase.ready()) {
    // Periodic heartbeat every 30 seconds
    if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
      lastHeartbeat = millis();
      sendAck("ESP Heartbeat [Uptime: " + String(millis() / 1000) + "s]");
    }
  }

  delay(10); // Small yield for RTOS / watchdog
}
