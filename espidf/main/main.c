#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "rom/ets_sys.h"
#include "mqtt_client.h"

static const char *TAG = "ESP32_C3_MQTT";

// ============================================================================
// 1. تنظیمات شبکه و MQTT Broker
// ============================================================================
#define WIFI_SSID       "Mahdi"
#define WIFI_PASS       "mlj14021400"
#define MQTT_BROKER_URI "mqtt://10.95.51.100"
#define MQTT_TOPIC      "psu/sensors/data"

// ============================================================================
// 2. پین‌های GPIO و I2C
// ============================================================================
#define DHT22_PIN          GPIO_NUM_4
#define I2C_SDA_PIN        GPIO_NUM_6
#define I2C_SCL_PIN        GPIO_NUM_7
#define INA206_ADDR        0x40

#define TM1637_CLK_PIN     GPIO_NUM_2
#define TM1637_DIO_PIN     GPIO_NUM_3
#define SHUNT_RESISTOR_OHM 0.1f

static esp_mqtt_client_handle_t mqtt_client = NULL;
static volatile bool mqtt_connected = false;
static i2c_master_dev_handle_t ina206_handle = NULL;

// event group برای همگام‌سازی اتصال Wi-Fi
static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
static int s_retry_num = 0;
#define WIFI_MAX_RETRY     10

// ============================================================================
// 3. درایور TM1637 (7-Segment) - با تأخیر زمانی صحیح
// ============================================================================
static const uint8_t digitToSegment[] = {
    0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f
};

#define TM1637_DELAY_US 5

void tm1637_start(void) {
    gpio_set_direction(TM1637_DIO_PIN, GPIO_MODE_OUTPUT);
    gpio_set_level(TM1637_CLK_PIN, 1);
    gpio_set_level(TM1637_DIO_PIN, 1);
    ets_delay_us(TM1637_DELAY_US);
    gpio_set_level(TM1637_DIO_PIN, 0);
    ets_delay_us(TM1637_DELAY_US);
    gpio_set_level(TM1637_CLK_PIN, 0);
    ets_delay_us(TM1637_DELAY_US);
}

void tm1637_stop(void) {
    gpio_set_direction(TM1637_DIO_PIN, GPIO_MODE_OUTPUT);
    gpio_set_level(TM1637_CLK_PIN, 0);
    gpio_set_level(TM1637_DIO_PIN, 0);
    ets_delay_us(TM1637_DELAY_US);
    gpio_set_level(TM1637_CLK_PIN, 1);
    ets_delay_us(TM1637_DELAY_US);
    gpio_set_level(TM1637_DIO_PIN, 1);
    ets_delay_us(TM1637_DELAY_US);
}

void tm1637_write_byte(uint8_t b) {
    for (int i = 0; i < 8; i++) {
        gpio_set_level(TM1637_CLK_PIN, 0);
        gpio_set_level(TM1637_DIO_PIN, (b >> i) & 0x01);
        ets_delay_us(TM1637_DELAY_US);
        gpio_set_level(TM1637_CLK_PIN, 1);
        ets_delay_us(TM1637_DELAY_US);
    }
    // ACK
    gpio_set_level(TM1637_CLK_PIN, 0);
    gpio_set_direction(TM1637_DIO_PIN, GPIO_MODE_INPUT);
    ets_delay_us(TM1637_DELAY_US);
    gpio_set_level(TM1637_CLK_PIN, 1);
    ets_delay_us(TM1637_DELAY_US);
    gpio_set_level(TM1637_CLK_PIN, 0);
    gpio_set_direction(TM1637_DIO_PIN, GPIO_MODE_OUTPUT);
}

void display_temperature(int temp) {
    if (temp < 0) temp = 0;
    if (temp > 99) temp = 99;

    uint8_t d1 = temp / 10;
    uint8_t d2 = temp % 10;

    tm1637_start();
    tm1637_write_byte(0x40);
    tm1637_stop();

    tm1637_start();
    tm1637_write_byte(0xC0);
    tm1637_write_byte(digitToSegment[d1]);
    tm1637_write_byte(digitToSegment[d2]);
    tm1637_write_byte(0x63); // علامت درجه °
    tm1637_write_byte(0x39); // حرف C
    tm1637_stop();

    tm1637_start();
    tm1637_write_byte(0x88 | 0x07); // روشنایی
    tm1637_stop();
}

// ============================================================================
// 4. درایور DHT22 (با محافظت در برابر context-switch)
// ============================================================================
static esp_err_t read_dht22(float *temperature, float *humidity) {
    uint8_t data[5] = {0};

    gpio_set_direction(DHT22_PIN, GPIO_MODE_OUTPUT);
    gpio_set_level(DHT22_PIN, 0);
    ets_delay_us(2000);
    gpio_set_level(DHT22_PIN, 1);
    ets_delay_us(30);
    gpio_set_direction(DHT22_PIN, GPIO_MODE_INPUT);

    portDISABLE_INTERRUPTS();

    uint16_t uSecCount = 0;
    while (gpio_get_level(DHT22_PIN) == 1) { if (++uSecCount > 100) { portENABLE_INTERRUPTS(); return ESP_FAIL; } ets_delay_us(1); }
    uSecCount = 0;
    while (gpio_get_level(DHT22_PIN) == 0) { if (++uSecCount > 100) { portENABLE_INTERRUPTS(); return ESP_FAIL; } ets_delay_us(1); }
    uSecCount = 0;
    while (gpio_get_level(DHT22_PIN) == 1) { if (++uSecCount > 100) { portENABLE_INTERRUPTS(); return ESP_FAIL; } ets_delay_us(1); }

    for (int i = 0; i < 40; i++) {
        uSecCount = 0;
        while (gpio_get_level(DHT22_PIN) == 0) { if (++uSecCount > 100) { portENABLE_INTERRUPTS(); return ESP_FAIL; } ets_delay_us(1); }
        ets_delay_us(35);
        if (gpio_get_level(DHT22_PIN) == 1) {
            data[i / 8] |= (1 << (7 - (i % 8)));
            uSecCount = 0;
            while (gpio_get_level(DHT22_PIN) == 1) { if (++uSecCount > 100) { portENABLE_INTERRUPTS(); return ESP_FAIL; } ets_delay_us(1); }
        }
    }

    portENABLE_INTERRUPTS();

    if (data[4] == ((data[0] + data[1] + data[2] + data[3]) & 0xFF)) {
        *humidity = ((data[0] << 8) | data[1]) * 0.1f;
        int16_t raw_temp = ((data[2] & 0x7F) << 8) | data[3];
        if (data[2] & 0x80) raw_temp = -raw_temp;
        *temperature = raw_temp * 0.1f;
        return ESP_OK;
    }
    return ESP_FAIL;
}

// ============================================================================
// 5. درایور INA206/INA219 (بر اساس API جدید I2C Master در ESP-IDF v6.0)
// ============================================================================
void i2c_master_init(void) {
    i2c_master_bus_config_t bus_config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = I2C_SDA_PIN,
        .scl_io_num = I2C_SCL_PIN,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true,
    };

    i2c_master_bus_handle_t bus_handle;
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_config, &bus_handle));

    i2c_device_config_t dev_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = INA206_ADDR,
        .scl_speed_hz = 100000,
    };

    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus_handle, &dev_config, &ina206_handle));
}

float read_ina206_voltage(void) {
    if (ina206_handle == NULL) return 0.0f;

    uint8_t reg = 0x02;
    uint8_t data[2] = {0};
    if (i2c_master_transmit_receive(ina206_handle, &reg, 1, data, 2, 100) == ESP_OK) {
        int16_t raw_val = (int16_t)((data[0] << 8) | data[1]);
        return (raw_val >> 3) * 0.004f;
    }
    ESP_LOGW(TAG, "I2C read (voltage) failed");
    return 0.0f;
}

float read_ina206_current_amperes(void) {
    if (ina206_handle == NULL) return 0.0f;

    uint8_t reg = 0x01;
    uint8_t data[2] = {0};
    if (i2c_master_transmit_receive(ina206_handle, &reg, 1, data, 2, 100) == ESP_OK) {
        int16_t raw_val = (int16_t)((data[0] << 8) | data[1]);
        float shunt_uV = raw_val * 2.5f;
        return ((shunt_uV / 1000.0f) / SHUNT_RESISTOR_OHM) / 1000.0f;
    }
    ESP_LOGW(TAG, "I2C read (current) failed");
    return 0.0f;
}

// ============================================================================
// 6. تنظیمات MQTT و Wi-Fi
// ============================================================================
static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    esp_mqtt_event_t *event = (esp_mqtt_event_t *) event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI("MQTT", "MQTT_EVENT_CONNECTED");
            mqtt_connected = true;
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW("MQTT", "MQTT_EVENT_DISCONNECTED");
            mqtt_connected = false;
            break;

        case MQTT_EVENT_ERROR:
            ESP_LOGE("MQTT", "MQTT_EVENT_ERROR");
            if (event->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
                ESP_LOGE("MQTT", "TCP transport error: errno=%d", event->error_handle->esp_transport_sock_errno);
            }
            break;

        case MQTT_EVENT_DATA:
            ESP_LOGI("MQTT", "Topic: %.*s", event->topic_len, event->topic);
            ESP_LOGI("MQTT", "Data: %.*s", event->data_len, event->data);
            break;

        default:
            break;
    }
}

static void mqtt_app_start(void) {
    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = MQTT_BROKER_URI,
    };
    mqtt_client = esp_mqtt_client_init(&mqtt_cfg);
    esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(mqtt_client);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_num < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGW(TAG, "Retry connecting to Wi-Fi... (%d/%d)", s_retry_num, WIFI_MAX_RETRY);
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *) event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static bool wifi_init_sta(void) {
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL, &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    // منتظر می‌مانیم تا وای‌فای واقعاً وصل شود یا تعداد تلاش‌ها تمام شود
    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                            pdFALSE, pdFALSE,
                                            pdMS_TO_TICKS(20000));

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Wi-Fi connected successfully");
        return true;
    }
    ESP_LOGE(TAG, "Failed to connect to Wi-Fi");
    return false;
}

// ============================================================================
// 7. تابع اصلی app_main
// ============================================================================
void app_main(void) {
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    gpio_set_direction(TM1637_CLK_PIN, GPIO_MODE_OUTPUT);
    gpio_set_direction(TM1637_DIO_PIN, GPIO_MODE_OUTPUT);

    if (!wifi_init_sta()) {
        ESP_LOGE(TAG, "Wi-Fi connection failed, restarting...");
        vTaskDelay(pdMS_TO_TICKS(3000));
        esp_restart();
    }

    i2c_master_init();
    mqtt_app_start();

    float temp = 0.0f, humidity = 0.0f;
    char json_payload[128];

    while (1) {
        if (read_dht22(&temp, &humidity) == ESP_OK) {
            display_temperature((int)temp);
        } else {
            ESP_LOGW(TAG, "DHT22 read failed");
        }

        float voltage_v = read_ina206_voltage();
        float current_a = read_ina206_current_amperes();

        snprintf(json_payload, sizeof(json_payload),
                 "{\"temperature\":%.2f,\"humidity\":%.2f,\"voltage_v\":%.2f,\"current_a\":%.3f}",
                 temp, humidity, voltage_v, current_a);

        if (mqtt_connected && mqtt_client != NULL) {
            int msg_id = esp_mqtt_client_publish(mqtt_client, MQTT_TOPIC, json_payload, 0, 1, 0);
            ESP_LOGI(TAG, "MQTT Sent Msg ID %d: %s", msg_id, json_payload);
        } else {
            ESP_LOGW(TAG, "MQTT not connected yet...");
        }

        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}