(function () {
  var script = document.currentScript;
  if (!script) {
    return;
  }

  var origin = new URL(script.src, window.location.href).origin;
  var objectName = script.getAttribute('data-object') || '';
  var recordId = script.getAttribute('data-record-id') || '';
  var label = script.getAttribute('data-label') || '';
  var match = window.location.pathname.match(
    /\/objects\/(companies|people)\/([0-9a-f-]{36})/i,
  );

  if (match && !recordId) {
    objectName = match[1].toLowerCase() === 'people' ? 'person' : 'company';
    recordId = match[2];
  }

  var style = document.createElement('style');
  style.textContent =
    '#call-my-crm-fab{position:fixed;right:24px;bottom:24px;z-index:2147483000;border:0;border-radius:999px;padding:14px 18px;background:#0c6b52;color:#f4fff9;font:600 15px/1 "Segoe UI",sans-serif;cursor:pointer;box-shadow:0 12px 30px rgba(28,25,21,.2)}' +
    '#call-my-crm-panel{position:fixed;right:24px;bottom:78px;width:min(420px,calc(100vw - 24px));height:min(640px,calc(100vh - 110px));z-index:2147483000;border:1px solid #e4d9c8;border-radius:18px;overflow:hidden;background:#fffdf8;box-shadow:0 18px 40px rgba(48,32,12,.18)}' +
    '#call-my-crm-panel[hidden]{display:none}' +
    '#call-my-crm-panel iframe{width:100%;height:100%;border:0}';
  document.head.append(style);

  var panel = document.createElement('div');
  panel.id = 'call-my-crm-panel';
  panel.hidden = true;
  var frame = document.createElement('iframe');
  frame.title = 'Call My CRM';
  var query = new URLSearchParams({ embed: '1' });
  if (objectName) {
    query.set('object', objectName);
  }
  if (recordId) {
    query.set('recordId', recordId);
  }
  if (label) {
    query.set('label', label);
  }
  frame.src = origin + '/?' + query.toString();
  panel.append(frame);

  var button = document.createElement('button');
  button.id = 'call-my-crm-fab';
  button.type = 'button';
  button.textContent = 'Call';
  button.addEventListener('click', function () {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-pressed', panel.hidden ? 'false' : 'true');
  });

  document.body.append(panel, button);
})();
