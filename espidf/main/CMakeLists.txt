idf_component_register(
    SRCS "main.c"
    INCLUDE_DIRS "."
    REQUIRES 
        esp_driver_gpio
        esp_driver_i2c      # <-- اضافه شده برای I2C
        esp_wifi
        nvs_flash
        esp_event
        esp_netif
        espressif__mqtt
)