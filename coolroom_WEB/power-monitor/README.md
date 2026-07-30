# PSU Monitor

A live dashboard for a power supply's telemetry: temperature, humidity,
current, and voltage. Numeric readouts, semi-circular gauges for
current/voltage (switchable to line or bar charts), a date/hour history
explorer, and dark/light mode. Readings are stored in MySQL and purged
automatically after 30 days.

## Structure

```
power-monitor/
├── index.html          # markup only
├── css/style.css        # all styling, incl. dark/light theme tokens
├── js/
│   ├── theme.js         # dark/light toggle
│   ├── gauges.js         # current & voltage gauge/line/bar panels
│   ├── history.js        # date/hour explorer chart
│   └── main.js            # polling + bootstrap
├── php/
│   ├── config.php        # DB connection settings — edit this first
│   ├── api.php             # read endpoints: latest, trend, history
│   ├── insert_data.php     # write endpoint for your sensor gateway
│   ├── cleanup.php         # cron script: purge readings > 30 days
│   └── simulate.php        # optional: generates fake demo data
└── sql/schema.sql        # table + optional MySQL auto-purge EVENT
```

## Setup

1. **Create the database.**
   ```bash
   mysql -u root -p < sql/schema.sql
   ```
   This creates the `psu_monitor` database, the `sensor_data` table, and
   (if your MySQL server has the event scheduler enabled) a daily job
   that deletes rows older than 30 days as a second safety net.

2. **Configure the connection.** Edit `php/config.php` and set
   `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS` to match your server. The
   commented-out `CREATE USER` / `GRANT` statements in `schema.sql` show
   how to make a least-privilege account instead of using root.

3. **Serve the project** with any PHP-capable web server, e.g. for a
   quick local test:
   ```bash
   php -S localhost:8000
   ```
   then open `http://localhost:8000/`.

4. **Feed it data.** Point your sensor gateway (ESP32, Arduino + serial
   bridge, Modbus poller, etc.) at `POST php/insert_data.php` with JSON:
   ```json
   { "temperature": 24.6, "humidity": 41.2, "current": 3.15, "voltage": 220.4 }
   ```
   For a quick demo without real hardware:
   ```bash
   php php/simulate.php --loop=200
   ```

5. **Schedule the 30-day purge.** Add a daily cron entry (this is a
   belt-and-braces companion to the SQL `EVENT` from step 1):
   ```
   0 3 * * * php /path/to/power-monitor/php/cleanup.php >> /var/log/psu-monitor-cleanup.log 2>&1
   ```

## Notes

- The gauge panels default to a 20 A / 250 V scale — adjust `GAUGE_CONFIG`
  in `js/gauges.js` to match your actual power supply's rated range.
- The history explorer averages readings into 15-minute buckets for a
  full-day view and 1-minute buckets when a single hour is selected, so
  the chart stays readable even with high-frequency sensor polling.
- Retention is enforced in three independent, overlapping ways: the
  cron script, the MySQL `EVENT`, and a low-probability opportunistic
  purge inside `insert_data.php`. Keep whichever combination fits your
  hosting environment — running more than one is safe since the
  `DELETE` is idempotent.
