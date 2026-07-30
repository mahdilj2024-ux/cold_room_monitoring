<?php
/**
 * api.php
 * Read-only JSON API consumed by js/main.js, js/gauges.js and
 * js/history.js.
 *
 *   GET ?action=latest
 *       -> most recent reading + today's min/max per metric
 *
 *   GET ?action=trend&metric=current|voltage|temperature|humidity&limit=40
 *       -> most recent N points, oldest first, for the gauge panels'
 *          line/bar views
 *
 *   GET ?action=history&metric=...&date=YYYY-MM-DD&hour=HH(optional)
 *       -> aggregated points for the history explorer. When "hour" is
 *          omitted the whole day is bucketed into 15-minute averages;
 *          when a single hour is given it's bucketed per minute.
 *
 *   GET ?action=records&page=1&per_page=25&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 *       -> raw, paginated rows for the "All Records" table page.
 *
 *   GET ?action=range&metric=temperature|humidity|current|voltage|all
 *                     &date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
 *       -> aggregated series (auto-sized buckets) for the "Charts" page,
 *          covering an arbitrary date range instead of a single day.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

header('Access-Control-Allow-Origin: *');

const METRIC_COLUMN_MAP = [
    'temperature' => 'temperature',
    'humidity'    => 'humidity',
    'current'     => 'current_a',
    'voltage'     => 'voltage_v',
];

function require_metric(string $metric): string
{
    if (!isset(METRIC_COLUMN_MAP[$metric])) {
        send_json(['error' => 'Unknown metric.'], 400);
    }
    return METRIC_COLUMN_MAP[$metric];
}

$action = $_GET['action'] ?? '';

try {
    $pdo = get_db_connection();

    switch ($action) {
        case 'latest':
            action_latest($pdo);
            break;

        case 'trend':
            action_trend($pdo);
            break;

        case 'history':
            action_history($pdo);
            break;

        case 'records':
            action_records($pdo);
            break;

        case 'range':
            action_range($pdo);
            break;

        default:
            send_json(['error' => 'Unknown or missing action.'], 400);
    }
} catch (Throwable $e) {
    send_json(['error' => 'Server error.', 'detail' => $e->getMessage()], 500);
}

/* ---------------------------------------------------------- */

function action_latest(PDO $pdo): void
{
    $stmt = $pdo->query(
        'SELECT temperature, humidity, current_a AS current, voltage_v AS voltage, recorded_at
         FROM sensor_data
         ORDER BY recorded_at DESC
         LIMIT 1'
    );
    $latest = $stmt->fetch();

    if (!$latest) {
        send_json(['data' => null]);
    }

    $rangeStmt = $pdo->query(
        "SELECT
            MIN(temperature) AS temperature_min, MAX(temperature) AS temperature_max,
            MIN(humidity)    AS humidity_min,    MAX(humidity)    AS humidity_max,
            MIN(current_a)   AS current_min,     MAX(current_a)   AS current_max,
            MIN(voltage_v)   AS voltage_min,     MAX(voltage_v)   AS voltage_max
         FROM sensor_data
         WHERE DATE(recorded_at) = CURDATE()"
    );
    $ranges = $rangeStmt->fetch() ?: [];

    send_json(['data' => array_merge($latest, $ranges)]);
}

function action_trend(PDO $pdo): void
{
    $metric = $_GET['metric'] ?? '';
    $column = require_metric($metric);
    $limit  = max(5, min(200, (int)($_GET['limit'] ?? 40)));

    $stmt = $pdo->prepare(
        "SELECT {$column} AS value, recorded_at
         FROM sensor_data
         ORDER BY recorded_at DESC
         LIMIT :limit"
    );
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->execute();
    $rows = array_reverse($stmt->fetchAll());

    $data = array_map(function ($row) {
        return [
            'time_label' => (new DateTime($row['recorded_at']))->format('H:i:s'),
            'value'      => (float)$row['value'],
        ];
    }, $rows);

    send_json(['data' => $data]);
}

function action_history(PDO $pdo): void
{
    $metric = $_GET['metric'] ?? '';
    $column = require_metric($metric);

    $date = $_GET['date'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
        send_json(['error' => 'A valid date (YYYY-MM-DD) is required.'], 400);
    }

    $hour = $_GET['hour'] ?? '';
    $hasHour = $hour !== '' && preg_match('/^\d{1,2}$/', $hour) && (int)$hour >= 0 && (int)$hour <= 23;

    // Bucket size in seconds: 60s buckets within a single hour, 15min buckets across a full day.
    // These two values are computed here, not user input, so it's safe to inline them —
    // and it sidesteps a real PDO limitation: native (non-emulated) prepared statements
    // reject the same named placeholder used more than once in one query.
    $bucketSeconds = $hasHour ? 60 : 900;
    $timeFormat    = $hasHour ? '%H:%i:%S' : '%H:%i';

    $sql = "SELECT
                DATE_FORMAT(
                    FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(recorded_at) / {$bucketSeconds}) * {$bucketSeconds}),
                    '{$timeFormat}'
                ) AS time_label,
                AVG({$column}) AS value,
                MIN(recorded_at) AS bucket_start
            FROM sensor_data
            WHERE DATE(recorded_at) = :date";

    if ($hasHour) {
        $sql .= ' AND HOUR(recorded_at) = :hour';
    }

    $sql .= ' GROUP BY bucket_start ORDER BY bucket_start ASC';

    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':date', $date, PDO::PARAM_STR);
    if ($hasHour) {
        $stmt->bindValue(':hour', (int)$hour, PDO::PARAM_INT);
    }
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $data = array_map(function ($row) {
        return [
            'time_label' => $row['time_label'],
            'value'      => round((float)$row['value'], 3),
        ];
    }, $rows);

    send_json(['data' => $data]);
}

function action_records(PDO $pdo): void
{
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $perPage = max(5, min(200, (int)($_GET['per_page'] ?? 25)));
    $offset  = ($page - 1) * $perPage;

    $dateFrom = $_GET['date_from'] ?? '';
    $dateTo   = $_GET['date_to'] ?? '';
    $hasFrom  = (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom);
    $hasTo    = (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo);

    $where  = [];
    $params = [];
    if ($hasFrom) {
        $where[] = 'recorded_at >= :date_from';
        $params[':date_from'] = $dateFrom . ' 00:00:00';
    }
    if ($hasTo) {
        $where[] = 'recorded_at <= :date_to';
        $params[':date_to'] = $dateTo . ' 23:59:59';
    }
    $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

    $countStmt = $pdo->prepare("SELECT COUNT(*) AS total FROM sensor_data {$whereSql}");
    foreach ($params as $key => $value) {
        $countStmt->bindValue($key, $value, PDO::PARAM_STR);
    }
    $countStmt->execute();
    $total = (int)$countStmt->fetch()['total'];

    $sql = "SELECT id, temperature, humidity, current_a AS current, voltage_v AS voltage, recorded_at
            FROM sensor_data
            {$whereSql}
            ORDER BY recorded_at DESC
            LIMIT {$perPage} OFFSET {$offset}";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
    }
    $stmt->execute();
    $rows = $stmt->fetchAll();

    send_json([
        'data' => $rows,
        'pagination' => [
            'page'        => $page,
            'per_page'    => $perPage,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $perPage) ?: 1,
        ],
    ]);
}

function action_range(PDO $pdo): void
{
    $metricParam = $_GET['metric'] ?? 'all';
    $metrics = $metricParam === 'all' ? array_keys(METRIC_COLUMN_MAP) : [$metricParam];
    foreach ($metrics as $m) {
        require_metric($m);
    }

    $dateFrom = $_GET['date_from'] ?? '';
    $dateTo   = $_GET['date_to'] ?? '';
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo)) {
        send_json(['error' => 'Valid date_from and date_to (YYYY-MM-DD) are required.'], 400);
    }

    $fromTs = strtotime($dateFrom . ' 00:00:00');
    $toTs   = strtotime($dateTo . ' 23:59:59');
    if ($fromTs === false || $toTs === false || $fromTs > $toTs) {
        send_json(['error' => 'Invalid date range.'], 400);
    }

    // Auto-size the bucket so a wide range doesn't return thousands of points.
    $spanSeconds = $toTs - $fromTs;
    if ($spanSeconds <= 6 * 3600) {
        $bucketSeconds = 60;          // <= 6h  -> 1-minute buckets
    } elseif ($spanSeconds <= 2 * 86400) {
        $bucketSeconds = 300;         // <= 2d  -> 5-minute buckets
    } elseif ($spanSeconds <= 7 * 86400) {
        $bucketSeconds = 1800;        // <= 7d  -> 30-minute buckets
    } else {
        $bucketSeconds = 7200;        // > 7d   -> 2-hour buckets
    }

    $result = [];
    foreach ($metrics as $metric) {
        $column = METRIC_COLUMN_MAP[$metric];

        $sql = "SELECT
                    FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(recorded_at) / {$bucketSeconds}) * {$bucketSeconds}) AS bucket_start,
                    AVG({$column}) AS value
                FROM sensor_data
                WHERE recorded_at BETWEEN :date_from AND :date_to
                GROUP BY bucket_start
                ORDER BY bucket_start ASC";

        $stmt = $pdo->prepare($sql);
        $stmt->bindValue(':date_from', $dateFrom . ' 00:00:00', PDO::PARAM_STR);
        $stmt->bindValue(':date_to', $dateTo . ' 23:59:59', PDO::PARAM_STR);
        $stmt->execute();
        $rows = $stmt->fetchAll();

        $result[$metric] = array_map(function ($row) use ($spanSeconds) {
            $format = $spanSeconds <= 2 * 86400 ? 'M j, H:i' : 'M j';
            return [
                'time_label' => (new DateTime($row['bucket_start']))->format($format),
                'value'      => round((float)$row['value'], 3),
            ];
        }, $rows);
    }

    send_json(['data' => $result, 'bucket_seconds' => $bucketSeconds]);
}
