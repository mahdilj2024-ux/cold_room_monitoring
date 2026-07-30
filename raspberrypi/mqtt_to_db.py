import json
import mysql.connector
import paho.mqtt.client as mqtt

# !!! آدرس آی‌پی لپ‌تاپ خود را اینجا وارد کنید !!!
LAPTOP_IP = '10.95.51.7'  # آی‌پی لپ‌تاپ شما در شبکه

DB_CONFIG = {
    'host': LAPTOP_IP,        # اتصال به دیتابیس روی لپ‌تاپ
    'user': 'psu_user',      # کاربری که در مرحله قبل ساختید
    'password': 'your_password',
    'database': 'psu_monitor',
    'port': 3306
}

MQTT_BROKER = 'localhost'   # چون Mosquitto روی خود رزبری‌پای نصب است
MQTT_PORT = 1883
MQTT_TOPIC = 'psu/sensors/data'

def save_to_db(data):
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor()
        
        query = """
            INSERT INTO sensor_data (temperature, humidity, current_a, voltage_v)
            VALUES (%s, %s, %s, %s)
        """
        values = (
            data.get('temperature', 0.0),
            data.get('humidity', 0.0),
            data.get('current_a', 0.0),
            data.get('voltage_v', 0.0)
        )
        
        cursor.execute(query, values)
        conn.commit()
        cursor.close()
        conn.close()
        print(f"[دیتا در لپ‌تاپ ذخیره شد] Temp: {values[0]} | Volt: {values[3]}")
    except Exception as e:
        print(f"[ error in connecting to pc    ] {e}")

def on_connect(client, userdata, flags, rc):
    if rc == 0:
        print("متصل شد به MQTT Broker روی رزبری‌پای!")
        client.subscribe(MQTT_TOPIC)
    else:
        print(f"خطا در اتصال به Broker، کد: {rc}")

def on_message(client, userdata, msg):
    try:
        payload_str = msg.payload.decode('utf-8')
        data = json.loads(payload_str)
        save_to_db(data)
    except Exception as e:
        print(f"خطا در پردازش داده: {e}")

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

client.connect(MQTT_BROKER, MQTT_PORT, 60)
client.loop_forever()