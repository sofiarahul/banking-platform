type RequestLogEntry = {
    timestamp: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
};

let activeTestKey: string | null = null;
const requestLogs = new Map<string, RequestLogEntry[]>();

const normaliseBody = (value: unknown): string | null => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

export function beginRequestCapture(testKey: string) {
    activeTestKey = testKey;
    requestLogs.set(testKey, []);
}

export function recordRequest({ method, url, body, headers }: {
    method: string;
    url: string;
    body?: unknown;
    headers?: Record<string, string>;
}) {
    if (!activeTestKey) {
        return;
    }

    const logs = requestLogs.get(activeTestKey) ?? [];
    logs.push({
        timestamp: new Date().toISOString(),
        method: method.toUpperCase(),
        url,
        headers: headers ?? {},
        body: normaliseBody(body),
    });
    requestLogs.set(activeTestKey, logs);
}

export function snapshotRequestLogs(testKey: string | null = activeTestKey): string {
    const key = testKey ?? activeTestKey;
    if (!key) {
        return 'No HTTP requests were captured for this test.';
    }

    const logs = requestLogs.get(key) ?? [];
    if (logs.length === 0) {
        return 'No HTTP requests were captured for this test.';
    }

    return logs.map((entry) => {
        const headerBlock = Object.keys(entry.headers).length > 0
            ? `Headers:\n${JSON.stringify(entry.headers, null, 2)}`
            : 'Headers: none';
        const bodyBlock = entry.body !== null && entry.body !== undefined
            ? `Body:\n${entry.body}`
            : 'Body: empty';

        return `[${entry.timestamp}] ${entry.method} ${entry.url}\n${headerBlock}\n${bodyBlock}`;
    }).join('\n\n---\n\n');
}

export function clearRequestCapture(testKey?: string) {
    const key = testKey ?? activeTestKey;
    if (key) {
        requestLogs.delete(key);
    }

    if (!testKey || activeTestKey === key) {
        activeTestKey = null;
    }
}
