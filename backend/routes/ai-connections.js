const {connections} = require('../lib/ai-connections');
function createAIConnectionsHandler(manager) {return async function handle(req, res, parts) {
    try {
        const action = parts[2], body = req.body || {};
        let result;
        if (req.method === 'GET' && !action) result = manager.status();
        else if (req.method === 'POST' && action === 'attach') result = await manager.attach(body.owner);
        else if (req.method === 'POST' && action === 'detach') result = await manager.detach(body.owner);
        else if (req.method === 'POST' && action === 'reconnect') result = await manager.reconnect(body.provider);
        else if (req.method === 'POST' && action === 'sign-in') result = await manager.signIn(body.provider, body.human_confirmed);
        else if (req.method === 'POST' && action === 'cancel-sign-in') result = await manager.cancelSignIn(body.provider);
        else throw Object.assign(Error('Film AI connection route not found.'), {status: 404});
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        res.end(JSON.stringify(result));
    } catch (error) {
        res.writeHead(error.status || 500, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        res.end(JSON.stringify({error: error.message}));
    }
};}
async function handleAIConnections(req,res,parts) {return createAIConnectionsHandler(connections())(req,res,parts);}
module.exports = {handleAIConnections,createAIConnectionsHandler};
