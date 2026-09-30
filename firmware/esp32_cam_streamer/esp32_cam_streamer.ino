/**
 * ======================================================================================
 * Project: ESP32-CAM MJPEG Video Streamer Test Firmware
 * Hardware Target: AI-Thinker ESP32-CAM (OV2640 Sensor)
 * 
 * Flashing Configuration in Arduino IDE:
 * - Board: "AI Thinker ESP32-CAM" (or "ESP32 Wrover Module")
 * - Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)"
 * - CPU Frequency: 240MHz (WiFi/BT)
 * - Flash Frequency: 80MHz
 * - Flash Mode: QIO
 * - Upload Speed: 115200 or 921600
 * 
 * Hardware Flashing Note:
 * - Connect GPIO 0 to GND before powering on to enter Flash Download Mode.
 * - After upload completes, disconnect GPIO 0 from GND and press RST button.
 * ======================================================================================
 */

#include "esp_camera.h"
#include <WiFi.h>
#include "esp_http_server.h"

// ======================================================================================
// CONFIGURATION: Set your Wi-Fi Credentials
// ======================================================================================
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Select Stream Port:
// Port 81 is the default used by the standard AI-Thinker CameraWebServer sketch
// Port 80 is standard HTTP. Either works with our web dashboard!
#define STREAM_SERVER_PORT 81

// ======================================================================================
// CAMERA PINOUT: AI-Thinker Model
// ======================================================================================
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// Optional on-board Flash LED
#define FLASH_LED_PIN      4

// ======================================================================================
// MJPEG Protocol Constants
// ======================================================================================
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* _STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* _STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char* _STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

httpd_handle_t stream_httpd = NULL;

// ======================================================================================
// MJPEG Stream Handler
// ======================================================================================
static esp_err_t stream_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;
  size_t _jpg_buf_len = 0;
  uint8_t * _jpg_buf = NULL;
  char * part_buf[64];

  // Set HTTP headers allowing CORS and MJPEG multipart stream
  res = httpd_resp_set_type(req, _STREAM_CONTENT_TYPE);
  if (res != ESP_OK) {
    return res;
  }
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
  httpd_resp_set_hdr(req, "X-Framerate", "25");

  Serial.println(F("[CAM STREAM] Client connected to live stream!"));

  while (true) {
    fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println(F("[CAM STREAM ERROR] Camera frame capture failed"));
      res = ESP_FAIL;
    } else {
      if (fb->format != PIXFORMAT_JPEG) {
        bool jpeg_converted = frame2jpg(fb, 80, &_jpg_buf, &_jpg_buf_len);
        esp_camera_fb_return(fb);
        fb = NULL;
        if (!jpeg_converted) {
          Serial.println(F("[CAM STREAM ERROR] JPEG conversion failed"));
          res = ESP_FAIL;
        }
      } else {
        _jpg_buf_len = fb->len;
        _jpg_buf = fb->buf;
      }
    }

    if (res == ESP_OK) {
      size_t hlen = snprintf((char *)part_buf, 64, _STREAM_PART, _jpg_buf_len);
      res = httpd_resp_send_chunk(req, (const char *)part_buf, hlen);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, (const char *)_jpg_buf, _jpg_buf_len);
    }
    if (res == ESP_OK) {
      res = httpd_resp_send_chunk(req, _STREAM_BOUNDARY, strlen(_STREAM_BOUNDARY));
    }

    if (fb) {
      esp_camera_fb_return(fb);
      fb = NULL;
      _jpg_buf = NULL;
    } else if (_jpg_buf) {
      free(_jpg_buf);
      _jpg_buf = NULL;
    }

    if (res != ESP_OK) {
      break;
    }
  }

  Serial.println(F("[CAM STREAM] Client disconnected from live stream."));
  return res;
}

// ======================================================================================
// Single Frame Snapshot Handler (GET /snapshot or GET /)
// ======================================================================================
static esp_err_t capture_handler(httpd_req_t *req) {
  camera_fb_t * fb = NULL;
  esp_err_t res = ESP_OK;

  fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println(F("[CAPTURE ERROR] Camera capture failed"));
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }

  httpd_resp_set_type(req, "image/jpeg");
  httpd_resp_set_hdr(req, "Content-Disposition", "inline; filename=capture.jpg");
  httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");

  res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

// ======================================================================================
// Start HTTP Stream Server
// ======================================================================================
void startCameraServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = STREAM_SERVER_PORT;
  config.ctrl_port = STREAM_SERVER_PORT;

  httpd_uri_t stream_uri = {
    .uri       = "/stream",
    .method    = HTTP_GET,
    .handler   = stream_handler,
    .user_ctx  = NULL
  };

  httpd_uri_t capture_uri = {
    .uri       = "/snapshot",
    .method    = HTTP_GET,
    .handler   = capture_handler,
    .user_ctx  = NULL
  };

  httpd_uri_t index_uri = {
    .uri       = "/",
    .method    = HTTP_GET,
    .handler   = capture_handler,
    .user_ctx  = NULL
  };

  Serial.printf("[SERVER] Starting MJPEG Stream Server on port: %d\n", config.server_port);
  if (httpd_start(&stream_httpd, &config) == ESP_OK) {
    httpd_register_uri_handler(stream_httpd, &stream_uri);
    httpd_register_uri_handler(stream_httpd, &capture_uri);
    httpd_register_uri_handler(stream_httpd, &index_uri);
    Serial.println(F("[SERVER] Endpoints registered:"));
    Serial.printf("  - Live MJPEG Stream: http://<IP>:%d/stream\n", config.server_port);
    Serial.printf("  - Single Snapshot:   http://<IP>:%d/snapshot\n", config.server_port);
  } else {
    Serial.println(F("[SERVER ERROR] Failed to start HTTP server."));
  }
}

// ======================================================================================
// Setup
// ======================================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println(F("##################################################"));
  Serial.println(F("#        ESP32-CAM MJPEG Video Streamer          #"));
  Serial.println(F("##################################################"));

  // Flash LED pin (low = off)
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  // Configure Camera Parameters
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Frame size & quality tuning
  // If PSRAM is present, run high quality VGA (640x480) with 2 frame buffers for smooth 20+ FPS
  if (psramFound()) {
    Serial.println(F("[PSRAM] Found external PSRAM! Enabling double frame buffering."));
    config.frame_size = FRAMESIZE_VGA;  // 640x480
    config.jpeg_quality = 12;           // 0-63 lower means higher quality
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    Serial.println(F("[PSRAM] No PSRAM detected. Falling back to QVGA (320x240)."));
    config.frame_size = FRAMESIZE_QVGA; // 320x240
    config.jpeg_quality = 14;
    config.fb_count = 1;
  }

  // Camera Initialization
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAMERA INIT ERROR] 0x%x. Halting.\n", err);
    Serial.println(F("Check camera ribbon cable seating and 5V power supply."));
    while (true) delay(1000);
  }
  Serial.println(F("[CAMERA] Camera hardware initialized successfully!"));

  // Optional sensor adjustments: flip/mirror if mounted upside down
  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    s->set_vflip(s, 1);    // 1 = flip vertically
    s->set_hmirror(s, 0);  // 1 = mirror horizontally
  }

  // Connect to Wi-Fi
  Serial.printf("[WIFI] Connecting to %s", ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  WiFi.setSleep(false); // Disable Wi-Fi sleep for low-latency streaming

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println(F("[WIFI] Connected Successfully!"));
  Serial.print(F("[WIFI] ESP32-CAM IP: "));
  Serial.println(WiFi.localIP());

  // Start MJPEG Server
  startCameraServer();

  // Print exact stream URL
  Serial.println();
  Serial.println(F("=================================================="));
  Serial.println(F(">>> ESP32-CAM READY FOR TEST-BENCH CONNECTION <<<"));
  Serial.printf("STREAM URL: http://%s:%d/stream\n", WiFi.localIP().toString().c_str(), STREAM_SERVER_PORT);
  Serial.printf("SNAPSHOT:   http://%s:%d/snapshot\n", WiFi.localIP().toString().c_str(), STREAM_SERVER_PORT);
  Serial.println(F("=================================================="));
}

// ======================================================================================
// Loop
// ======================================================================================
void loop() {
  // HTTP server handles streaming asynchronously in background FreeRTOS tasks
  delay(1000);
}
