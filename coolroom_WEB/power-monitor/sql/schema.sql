-- =========================================================
-- PSU Monitor — database schema
-- =========================================================

CREATE DATABASE IF NOT EXISTS psu_monitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE psu_monitor;

CREATE TABLE IF NOT EXISTS sensor_data (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  temperature   DECIMAL(6,2) NOT NULL COMMENT 'Degrees Celsius',
  humidity      DECIMAL(6,2) NOT NULL COMMENT 'Relative humidity %',
  current_a     DECIMAL(8,3) NOT NULL COMMENT 'Amperes',
  voltage_v     DECIMAL(8,3) NOT NULL COMMENT 'Volts',
  recorded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_recorded_at (recorded_at)
) ENGINE=InnoDB;

-- Dedicated application user (optional, recommended over root).
-- CREATE USER IF NOT EXISTS 'psu_monitor_user'@'%' IDENTIFIED BY 'change-me';
-- GRANT SELECT, INSERT, DELETE ON psu_monitor.* TO 'psu_monitor_user'@'%';
-- FLUSH PRIVILEGES;

-- =========================================================
-- Automatic 30-day retention (belt-and-braces alongside the
-- cron-driven php/cleanup.php script). Requires the MySQL
-- event scheduler to be enabled on the server:
--   SET GLOBAL event_scheduler = ON;
-- =========================================================

DELIMITER $$

CREATE EVENT IF NOT EXISTS purge_old_sensor_data
ON SCHEDULE EVERY 1 DAY
STARTS CURRENT_TIMESTAMP
DO
BEGIN
  DELETE FROM sensor_data
  WHERE recorded_at < (NOW() - INTERVAL 30 DAY)
  ORDER BY recorded_at ASC
  LIMIT 50000;
END$$

DELIMITER ;
