<?php
/**
 * cleanup.php
 * Deletes readings older than DATA_RETENTION_DAYS, oldest first, in
 * batches so a large backlog never locks the table for too long.
 *
 * Intended to run from cron, once a day, e.g.:
 *   0 3 * * * php /path/to/power-monitor/php/cleanup.php >> /var/log/psu-monitor-cleanup.log 2>&1
 *
 * (This duplicates the MySQL EVENT defined in sql/schema.sql — keep
 * whichever mechanism fits your hosting setup, or keep both; the
 * DELETE is idempotent either way.)
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

const BATCH_SIZE = 5000;

$pdo = get_db_connection();
$days = (int)DATA_RETENTION_DAYS;

$totalDeleted = 0;

while (true) {
    $stmt = $pdo->prepare(
        "DELETE FROM sensor_data
         WHERE recorded_at < (NOW() - INTERVAL {$days} DAY)
         ORDER BY recorded_at ASC
         LIMIT :batch"
    );
    $stmt->bindValue(':batch', BATCH_SIZE, PDO::PARAM_INT);
    $stmt->execute();

    $deleted = $stmt->rowCount();
    $totalDeleted += $deleted;

    if ($deleted < BATCH_SIZE) {
        break;
    }
}

$message = sprintf(
    '[%s] Cleanup complete. Deleted %d rows older than %d days.%s',
    date('Y-m-d H:i:s'),
    $totalDeleted,
    $days,
    PHP_EOL
);

// CLI: print to stdout. Web: return JSON (useful if triggered by a
// hosting panel's "URL cron" feature instead of real cron).
if (PHP_SAPI === 'cli') {
    echo $message;
} else {
    send_json(['status' => 'ok', 'deleted' => $totalDeleted]);
}
