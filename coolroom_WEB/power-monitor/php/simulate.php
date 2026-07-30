<?php
/**
 * simulate.php
 * Optional helper for local testing/demo purposes only — generates a
 * plausible sensor reading and inserts it directly into the database.
 * Not required in production once a real sensor gateway is posting to
 * insert_data.php.
 *
 * Usage (CLI):
 *   php simulate.php            // insert one reading
 *   php simulate.php --loop=60  // insert one reading every 5s, 60 times
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

function random_reading(): array
{
    return [
        'temperature' => round(20 + mt_rand(-50, 120) / 10, 2),   // ~15–32 °C
        'humidity'    => round(35 + mt_rand(-100, 250) / 10, 2),  // ~25–60 %RH
        'current'     => round(2 + mt_rand(-150, 600) / 100, 3),  // ~0.5–8 A
        'voltage'     => round(220 + mt_rand(-100, 100) / 10, 2), // ~210–230 V
    ];
}

function insert_reading(PDO $pdo, array $reading): void
{
    $stmt = $pdo->prepare(
        'INSERT INTO sensor_data (temperature, humidity, current_a, voltage_v, recorded_at)
         VALUES (:temperature, :humidity, :current, :voltage, NOW())'
    );
    $stmt->execute([
        ':temperature' => $reading['temperature'],
        ':humidity'    => $reading['humidity'],
        ':current'     => $reading['current'],
        ':voltage'     => $reading['voltage'],
    ]);
}

if (PHP_SAPI !== 'cli') {
    send_json(['error' => 'simulate.php is a CLI-only tool.'], 403);
}

$pdo = get_db_connection();

$loopArg = null;
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--loop=')) {
        $loopArg = (int)substr($arg, 7);
    }
}

$iterations = $loopArg ?? 1;

for ($i = 0; $i < $iterations; $i++) {
    $reading = random_reading();
    insert_reading($pdo, $reading);
    echo sprintf(
        "[%s] T=%.1f°C H=%.1f%% I=%.2fA V=%.1fV%s",
        date('H:i:s'),
        $reading['temperature'],
        $reading['humidity'],
        $reading['current'],
        $reading['voltage'],
        PHP_EOL
    );
    if ($iterations > 1 && $i < $iterations - 1) {
        sleep(5);
    }
}
