/** Own one CLI. The control pipe stays open after task stdin ends, so backend
 * death still closes this pipe and terminates the CLI. No persistent daemon. */
const {spawn} = require('child_process');
const {StringDecoder} = require('string_decoder');
let specification;
try {specification = JSON.parse(process.argv[2]);} catch {process.exit(1);}
if (!specification || typeof specification.bin !== 'string' || !Array.isArray(specification.args)) process.exit(1);
let child, stopping = false, closed = false, buffer = '', killTimer;
const decoder = new StringDecoder('utf8');
function stop() {
    if (closed || stopping) return;
    stopping = true;
    child?.kill('SIGTERM');
    killTimer = setTimeout(() => child?.kill('SIGKILL'), 1000);
}
function error(message) {
    process.stderr.write('Film owned worker: ' + message + '\n'); stop();
}
try {child = spawn(specification.bin, specification.args, {cwd: process.cwd(), env: process.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false});}
catch {process.exit(1);}
child.on('spawn', () => process.stdout.write(JSON.stringify({type: 'film.worker.ready'}) + '\n'));
child.stdout.pipe(process.stdout, {end: false});
child.stderr.pipe(process.stderr, {end: false});
child.stdin.on('error', () => stop());
child.on('error', () => error('Provider CLI could not start.'));
child.on('close', (code, signal) => {
    closed = true; clearTimeout(killTimer);
    process.exitCode = Number.isInteger(code) ? code : signal ? 143 : 1;
    process.stdin.destroy();
});
process.stdin.on('data', chunk => {
    buffer += decoder.write(chunk);
    if (buffer.length > 2000000) return error('Input exceeded the limit.');
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
        let request;
        try {request = JSON.parse(line);} catch {error('Invalid owned control message.'); return;}
        if (stopping || closed || request.type !== 'input' || typeof request.value !== 'string') {error('Invalid owned input.'); return;}
        if (request.close) child.stdin.end(request.value);
        else child.stdin.write(request.value);
    }
});
process.stdin.on('end', stop);
process.stdin.on('error', stop);
process.stdout.on('error', stop);
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, stop);
