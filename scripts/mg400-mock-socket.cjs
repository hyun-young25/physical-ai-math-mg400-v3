// Test-only, in-browser protocol v2 mock. No robot or PC sockets are opened.
exports.installMockBridge = async context => {
  const state = { requests: [], delay: 80, drop: null, pause: false };
  const cleanupHandlers = new Set();
  state.dispose = () => { for (const cleanup of [...cleanupHandlers]) cleanup(); };
  await context.routeWebSocket(/127\.0\.0\.1:8765/, ws => {
    let seq = 0, connected = false, motion;
    const m = { source: 'mock', ageMs: 0, pose: { x: 250, y: -150, z: 300, r: 0 },
      joints: { j1: 0, j2: 0, j3: 0, j4: 0 }, enabled: false, moving: false,
      error: false, robotMode: 4, user: 0, tool: 0, inputBits: '0', outputBits: '0' };
    const publish = () => {
      if (connected && !state.pause) ws.send(JSON.stringify({ type: 'measurement',
        measurement: { ...m, seq: ++seq, measuredAt: Date.now() } }));
    };
    const reply = id => ws.send(JSON.stringify({ type: 'reply', id, ok: true, result: { seq } }));
    // Test controls change only in-browser mock packets, never an external device.
    state.measurement = m;
    state.publish = publish;
    const timer = setInterval(publish, 100);
    const cleanup = () => { clearInterval(timer); clearTimeout(motion); cleanupHandlers.delete(cleanup); };
    cleanupHandlers.add(cleanup);
    state.drop = () => ws.close();
    ws.onClose(cleanup);
    ws.onMessage(raw => {
      const r = JSON.parse(raw); state.requests.push(r);
      if (r.type === 'connect') {
        connected = true; ws.send(JSON.stringify({ type: 'hello', protocol: 2, model: 'MG400', source: 'mock' }));
        publish(); reply(r.id);
      } else if (r.type === 'configure') {
        const finish=()=>{m.user = r.setup.user; m.tool = r.setup.tool; publish(); reply(r.id);};
        if(state.rejectConfigure){
          ws.send(JSON.stringify({type:'reply',id:r.id,ok:false,error:'모의 설정 적용 실패'}));return;
        }
        if(state.holdConfigure){state.finishConfigure=finish;return;}
        finish();
      } else if (r.type === 'stop') {
        clearTimeout(motion); m.moving = false; m.robotMode = m.enabled ? 5 : 4; publish(); reply(r.id);
      } else if (r.type === 'execute') {
        if (state.rejectNext) {
          const error = state.rejectNext; state.rejectNext = null;
          ws.send(JSON.stringify({ type: 'reply', id: r.id, ok: false, error })); return;
        }
        if (state.staleReply) {
          state.staleReply = false;
          ws.send(JSON.stringify({ type: 'reply', id: r.id, ok: true, result: { seq: 0 } })); return;
        }
        const op = r.operation;
        if (op.kind === 'move') {
          m.moving = true; m.robotMode = 7; publish();
          motion = setTimeout(() => {
            m.pose = { ...op.target }; m.moving = false; m.robotMode = 5; publish(); reply(r.id);
          }, state.delay);
        } else {
          if (op.kind === 'enable' || op.kind === 'disable') {
            m.enabled = op.kind === 'enable'; m.robotMode = m.enabled ? 5 : 4;
          }
          if (op.kind === 'suction') { m.outputBits = op.on ? '1' : '0'; m.inputBits = op.on ? '1' : '0'; }
          publish(); reply(r.id);
        }
      }
    });
  });
  return state;
};
