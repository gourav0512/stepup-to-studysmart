(async () => { try { await api('/auth/me', { silent: true }); location.href = '/app.html'; } catch {} })();

$$('.tab').forEach((b) => b.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('on', x === b));
  $('#login').classList.toggle('hide', b.dataset.tab !== 'login');
  $('#signup').classList.toggle('hide', b.dataset.tab !== 'signup');
}));
$$('[data-show]').forEach((b) => b.addEventListener('click', () => {
  const i = $('#' + b.dataset.show); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? 'Show' : 'Hide';
}));

const strength = (p) => (p.length >= 8) + (/[A-Za-z]/.test(p) && /\d/.test(p)) + (p.length >= 12 && /[^A-Za-z0-9]/.test(p));
$('#sp').addEventListener('input', (e) => {
  const s = strength(e.target.value);
  $$('#meter i').forEach((el, i) => { el.className = i < s ? 'on' + (s === 1 ? 1 : s === 2 ? 2 : 3) : ''; });
});

const rules = {
  sr: (v) => (/^[A-Za-z0-9]{5,20}$/.test(v) ? '' : 'Roll number: 5-20 letters or digits.'),
  se: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Enter a valid email.'),
  sp: (v) => (v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v) ? '' : 'Min 8 characters with a letter and a number.'),
  sc: (v) => (v === $('#sp').value ? '' : 'Passwords do not match.'),
};
Object.keys(rules).forEach((id) => $('#' + id).addEventListener('blur', () => { $(`[data-for=${id}]`).textContent = rules[id]($('#' + id).value); }));

async function submit(form, msgEl, path, body) {
  const btn = $('button[type=submit]', form); btn.disabled = true; msgEl.textContent = '';
  try { await api(path, { method: 'POST', body, silent: true }); location.href = '/app.html'; }
  catch (e) { msgEl.textContent = e.message; btn.disabled = false; }
}
$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  submit(e.target, $('#lmsg'), '/auth/login', { email: $('#le').value, password: $('#lp').value });
});
$('#signup').addEventListener('submit', (e) => {
  e.preventDefault();
  let bad = false;
  Object.keys(rules).forEach((id) => { const m = rules[id]($('#' + id).value); $(`[data-for=${id}]`).textContent = m; if (m) bad = true; });
  if ($('#sn').value.trim().length < 2) { $('#smsg').textContent = 'Enter your name.'; return; }
  if (bad) return;
  submit(e.target, $('#smsg'), '/auth/register', { name: $('#sn').value, roll_no: $('#sr').value, email: $('#se').value, password: $('#sp').value, confirm_password: $('#sc').value });
});
