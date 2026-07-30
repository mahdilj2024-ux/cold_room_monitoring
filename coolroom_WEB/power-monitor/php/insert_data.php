<?php
/**
 * insert_data.php
 * Endpoint your sensor gateway (or a test script) POSTs readings to.
 *
 *   POST insert_data.php
 *   Content-Type: application/json
 *   { "temperature": 24.6, "humidity": 41.2, "current": 3.15, "voltage": 220.4 }
 *
 * Form-encoded POST fields with the same names also work.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    send_json(['error' => 'Only POST is allowed.'], 405);
}

$raw = file_get_contents('php://input');
$json = json_decode($raw ?: '', true);
$input = is_array($json) ? $json : $_POST;

$required = ['temperature', 'humidity', 'current', 'voltage'];
foreach ($required as $field) {
    if (!isset($input[$field]) || !is_numeric($input[$field])) {
        send_json(['error' => "Missing or invalid field: {$field}"], 422);
    }
}

try {
    $pdo = get_db_connection();

    $stmt = $pdo->prepare(
        'INSERT INTO sensor_data (temperature, humidity, current_a, voltage_v, recorded_at)
         VALUES (:temperature, :humidity, :current, :voltage, NOW())'
    );
    $stmt->execute([
        ':temperature' => (float)$input['temperature'],
        ':humidity'    => (float)$input['humidity'],
        ':current'     => (float)$input['current'],
        ':voltage'     => (float)$input['voltage'],
    ]);

    // Cheap, low-overhead safety net: occasionally piggy-back a purge of
    // anything past the retention window instead of waiting for cron.
    if (random_int(1, 50) === 1) {
        $days = (int)DATA_RETENTION_DAYS;
        $pdo->exec(
            "DELETE FROM sensor_data WHERE recorded_at < (NOW() - INTERVAL {$days} DAY) ORDER BY recorded_at ASC LIMIT 5000"
        );
    }

    send_json(['status' => 'ok', 'id' => (int)$pdo->lastInsertId()], 201);
} catch (Throwable $e) {
    send_json(['error' => 'Insert failed.', 'detail' => $e->getMessage()], 500);
}
