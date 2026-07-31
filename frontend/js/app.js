const API = window.location.origin;
let me = null;
let cwFilter = '';
let qaCache = [];
let currentQuestionId = null;

// ====== Auth ======
window.onload = async () => {
    try {
        const r = await fetch(`${API}/api/me`, { credentials: 'include' });
        const d = await r.json();
        d.user ? showApp(d.user) : showAuth();
    } catch(e) { showAuth(); }
};

function showAuth() { document.getElementById('authPage').classList.remove('hidden'); document.getElementById('app').classList.add('hidden'); }
function showApp(user) {
    me = user;
    document.getElementById('authPage').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('dispName').textContent = user.display_name || user.username;
    document.getElementById('heroName').textContent = user.display_name || user.username;
    document.getElementById('todayChip').textContent = formatToday();
    const tag = document.getElementById('roleTag');
    tag.textContent = user.role === 'teacher' ? '教师' : '学生';
    tag.className = `role-badge ${user.role}`;
    document.getElementById('hwName').value = user.display_name || user.username;
    document.getElementById('cwUpload').classList.toggle('hidden', user.role !== 'teacher');
    switchTab('home');
}

function switchAuth(t) {
    document.querySelectorAll('.auth-tab').forEach((b,i) => b.classList.toggle('active', (t==='login'?0:1)===i));
    document.getElementById('form-login').classList.toggle('active', t==='login');
    document.getElementById('form-register').classList.toggle('active', t==='register');
}

function authErr(id, msg) { const e = document.getElementById(id); e.textContent = msg; e.style.display = 'block'; setTimeout(() => e.style.display = 'none', 3500); }

async function login() {
    const u = document.getElementById('loginUser').value.trim(), p = document.getElementById('loginPass').value;
    if (!u||!p) return authErr('loginErr','请填写用户名和密码');
    const r = await fetch(`${API}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({username:u,password:p}) });
    const d = await r.json();
    r.ok ? showApp(d.user) : authErr('loginErr', d.error);
}

async function register() {
    const username = document.getElementById('regUser').value.trim(), display_name = document.getElementById('regName').value.trim(), password = document.getElementById('regPass').value;
    if (!username||!password) return authErr('regErr','请填写用户名和密码');
    const r = await fetch(`${API}/api/register`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({username,password,display_name}) });
    const d = await r.json();
    r.ok ? showApp(d.user) : authErr('regErr', d.error);
}

async function logout() {
    await fetch(`${API}/api/logout`, { method:'POST', credentials:'include' });
    me = null; showAuth();
}

// ====== Tabs ======
function switchTab(t) {
    ['home','courseware','homework','qa'].forEach((name) => {
        document.getElementById(`tab-${name}`).classList.toggle('active', name===t);
    });
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        const target = btn.getAttribute('onclick')?.match(/switchTab\('([^']+)'\)/)?.[1];
        btn.classList.toggle('active', target === t && !btn.classList.contains('muted-nav'));
    });
    if (t==='courseware') loadCourseware();
    if (t==='homework') loadHomeworks();
    if (t==='qa') loadQuestions();
    requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ====== Courseware ======
function filterCourseware(subj) {
    cwFilter = subj;
    document.querySelectorAll('#cwSubjectFilter .subject-chip').forEach(c => c.classList.toggle('active', c.textContent===subj||(subj===''&&c.textContent==='全部')));
    loadCourseware();
}

async function loadCourseware() {
    const el = document.getElementById('cwList');
    el.innerHTML = '<div class="empty-msg">加载中...</div>';
    const url = cwFilter ? `${API}/api/courseware?subject=${encodeURIComponent(cwFilter)}` : `${API}/api/courseware`;
    const r = await fetch(url, { credentials:'include' });
    const d = await r.json();
    if (!d.coursewares.length) { el.innerHTML = '<div class="empty-msg">暂无课件</div>'; return; }
    el.innerHTML = d.coursewares.map(c => `
        <div class="cw-card">
            <div>
                <h3>${esc(c.title)}</h3>
                <p class="meta">${esc(c.subject)} · ${esc(c.original_name)} · ${esc(c.upload_time)}</p>
            </div>
            <div style="display:flex;gap:6px;">
                <a href="${API}/uploads/${esc(c.filename)}" target="_blank" class="btn btn-primary btn-small" style="text-decoration:none;">查看</a>
                ${me.role==='teacher' ? `<button class="btn btn-danger btn-small" onclick="delCw('${c.id}')">删</button>` : ''}
            </div>
        </div>
    `).join('');
}

async function uploadCourseware() {
    const title = document.getElementById('cwTitle').value.trim();
    const subject = document.getElementById('cwSubject').value;
    const file = document.getElementById('cwFile').files[0];
    if (!title) return toast('请输入标题','err');
    if (!file) return toast('请选择文件','err');
    const fd = new FormData();
    fd.append('title', title); fd.append('subject', subject); fd.append('file', file);
    const r = await fetch(`${API}/api/courseware/upload`, { method:'POST', credentials:'include', body: fd });
    const d = await r.json();
    if (r.ok) { document.getElementById('cwTitle').value=''; document.getElementById('cwFile').value=''; loadCourseware(); }
    toast(d.message||d.error, r.ok?'ok':'err');
}

async function delCw(id) {
    if (!confirm('确定删除？')) return;
    const r = await fetch(`${API}/api/courseware/${id}`, { method:'DELETE', credentials:'include' });
    const d = await r.json();
    if (r.ok) loadCourseware();
    toast(d.message||d.error, r.ok?'ok':'err');
}

// ====== Homework ======
function previewHw(e) {
    const f = e.target.files[0]; if (!f) return;
    document.getElementById('hwPreview').src = URL.createObjectURL(f);
    document.getElementById('hwPreview').classList.remove('hidden');
    document.getElementById('hwUploadHint').classList.add('hidden');
}

async function uploadHomework() {
    const name = document.getElementById('hwName').value.trim();
    const subject = document.getElementById('hwSubject').value;
    const file = document.getElementById('hwFile').files[0];
    if (!name) return toast('请填写姓名','err');
    if (!file) return toast('请选择图片','err');
    const fd = new FormData();
    fd.append('student_name', name); fd.append('subject', subject); fd.append('file', file);
    const r = await fetch(`${API}/api/homeworks/upload`, { method:'POST', credentials:'include', body: fd });
    const d = await r.json();
    if (r.ok) {
        document.getElementById('hwFile').value='';
        document.getElementById('hwPreview').classList.add('hidden');
        document.getElementById('hwUploadHint').classList.remove('hidden');
        loadHomeworks();
    }
    toast(d.message||d.error, r.ok?'ok':'err');
}

async function loadHomeworks() {
    const el = document.getElementById('hwList');
    el.innerHTML = '<div class="empty-msg">加载中...</div>';
    const r = await fetch(`${API}/api/homeworks`, { credentials:'include' });
    const d = await r.json();
    if (!d.homeworks.length) { el.innerHTML = '<div class="empty-msg">暂无作业记录</div>'; return; }
    el.innerHTML = `<div class="hw-grid">${d.homeworks.map(h => hwCard(h)).join('')}</div>`;
}

function hwCard(h) {
    const sc = { '待批改':'pending','批改中':'reviewing','已批改':'done','已完成':'done','待修改':'pending' }[h.status]||'pending';
    const tools = me.role==='teacher' ? `
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            <button class="btn btn-success btn-small" onclick="reviewHw('${h.id}','已批改')">通过</button>
            <button class="btn btn-warning btn-small" onclick="reviewHw('${h.id}','批改中')">批改中</button>
            <button class="btn btn-danger btn-small" onclick="reviewHw('${h.id}','待修改')">需修改</button>
        </div>
        <textarea id="cmt-${h.id}" class="form-group" style="margin-top:6px;min-height:50px;" placeholder="评语">${esc(h.comment||'')}</textarea>
        <button class="btn btn-primary btn-small btn-block" onclick="saveCmt('${h.id}')">保存评语</button>
    ` : (h.comment ? `<p class="meta">评语：${esc(h.comment)}</p>` : '');
    return `<div class="hw-card">
        <img src="${API}/uploads/${esc(h.filename)}" onclick="openModal('${API}/uploads/${esc(h.filename)}')" alt="">
        <h3>${esc(h.student_name)} · ${esc(h.subject)}</h3>
        <p class="meta">${esc(h.upload_time)} <span class="status-tag ${sc}">${esc(h.status)}</span></p>
        ${tools}
    </div>`;
}

async function reviewHw(id, status) {
    const r = await fetch(`${API}/api/homeworks/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({status}) });
    const d = await r.json();
    if (r.ok) loadHomeworks();
    toast(d.message||d.error, r.ok?'ok':'err');
}

async function saveCmt(id) {
    const comment = document.getElementById(`cmt-${id}`).value;
    const r = await fetch(`${API}/api/homeworks/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({comment}) });
    const d = await r.json();
    toast(d.message||d.error, r.ok?'ok':'err');
}

// ====== QA ======
function previewQa(e) {
    const f = e.target.files[0]; if (!f) return;
    document.getElementById('qaPreview').src = URL.createObjectURL(f);
    document.getElementById('qaPreview').classList.remove('hidden');
    document.getElementById('qaUploadHint').classList.add('hidden');
}

async function askQuestion() {
    const file = document.getElementById('qaFile').files[0];
    if (!file) return toast('请先上传题目图片','err');
    const btn = document.getElementById('qaBtn');
    btn.disabled = true; btn.textContent = 'AI 正在解题...';
    document.getElementById('qaModel').textContent = '思考中';
    document.getElementById('qaAnswer').innerHTML = '';
    document.getElementById('qaClearBtn').classList.add('hidden');

    const fd = new FormData();
    fd.append('subject', document.getElementById('qaSubject').value);
    fd.append('question_text', document.getElementById('qaText').value.trim());
    fd.append('file', file);

    try {
        const r = await fetch(`${API}/api/questions/ask`, { method:'POST', credentials:'include', body: fd });
        if (!r.ok) throw new Error((await r.json()).error || '请求失败');

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let answerEl = document.getElementById('qaAnswer');
        let modelEl = document.getElementById('qaModel');
        let rawText = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            // Process complete SSE events
            const parts = buf.split('\n\n');
            buf = parts.pop(); // keep incomplete last part

            for (const block of parts) {
                for (const line of block.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const d = JSON.parse(line.slice(6));
                        if (d.t === 'c') {
                            rawText += d.c;
                            answerEl.innerHTML = renderAnswer(rawText);
                        } else if (d.t === 'k') {
                            modelEl.textContent = '深度思考中';
                            if (!rawText) answerEl.innerHTML = renderThinkingStatus(d.c);
                        } else if (d.t === 'd') {
                            modelEl.textContent = d.m;
                        } else if (d.t === 'e') {
                            answerEl.innerHTML = renderAnswer(d.c);
                            modelEl.textContent = '出错';
                        } else if (d.t === 'r') {
                            currentQuestionId = d.id;
                            modelEl.textContent = d.m;
                            document.getElementById('qaClearBtn').classList.remove('hidden');
                            showFollowupBox(d.id);
                        }
                    } catch(e) {}
                }
            }
        }

        if (!rawText && buf) {
            // handle any remaining buffer as final response
            try {
                const d = JSON.parse(buf.trim().replace(/^data: /, ''));
                if (d.t === 'e') {
                    answerEl.innerHTML = renderAnswer(d.c);
                    modelEl.textContent = '出错';
                }
            } catch(e) {}
        }

        toast('答疑完成', 'ok');
        loadQuestions();
    } catch(e) {
        document.getElementById('qaModel').textContent = '出错';
        document.getElementById('qaAnswer').textContent = e.message;
        toast(e.message, 'err');
    } finally {
        btn.disabled = false; btn.textContent = '开始答疑';
    }
}

function renderAnswer(text) {
    if (!text) return '<p>等待 AI 输出...</p>';
    let h = prepareAnswerText(text);
    h = esc(h);
    h = restoreFractions(h);
    // Markdown headings
    h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    // Bold
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // List items
    h = h.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    h = h.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<li>$1. $2</li>');
    h = h.replace(/(<li>.*<\/li>)/gs, m => `<ul>${m}</ul>`);
    // Paragraphs
    h = h.replace(/\n\n/g, '</p><p>');
    h = h.replace(/\n/g, '<br>');
    h = '<p>' + h + '</p>';
    // Clean up tag nesting
    h = h.replace(/<p><h([23])>/g, '<h$1>').replace(/<\/h([23])><\/p>/g, '</h$1>');
    h = h.replace(/<p><ul>/g, '<ul>').replace(/<\/ul><\/p>/g, '</ul>');
    h = h.replace(/<\/li>(?:<br>\s*)+<li>/g, '</li><li>');
    h = h.replace(/<ul>(?:<br>\s*)+/g, '<ul>').replace(/(?:<br>\s*)+<\/ul>/g, '</ul>');
    scheduleMathTypeset();
    return h;
}

function renderThinkingStatus(text) {
    return `
        <div class="thinking-status">
            <strong>思考摘要</strong>
            ${esc(text || '深度思考已开启：正在识别题目、提取条件、选择化学原理并组织可读推理过程...')}
        </div>
    `;
}

let mathTypesetTimer = null;
function scheduleMathTypeset() {
    clearTimeout(mathTypesetTimer);
    mathTypesetTimer = setTimeout(() => {
        if (window.MathJax?.typesetPromise) {
            window.MathJax.typesetPromise([document.getElementById('qaAnswer')]).catch(() => {});
        }
    }, 80);
}

function prepareAnswerText(text) {
    let source = normalizeLatexEscapes(String(text ?? ''));
    source = normalizeDottedAtoms(source);
    source = transformOutsideMath(source, normalizePlainTextMath);
    return source;
}

function normalizeLatexEscapes(value) {
    return String(value ?? '').replace(/\\\\(?=[A-Za-z])/g, '\\');
}

function normalizeDottedAtoms(value) {
    let s = String(value ?? '');
    s = s.replace(/\\ddot\s*\{([^{}]+)\}/g, '\\ddot{$1}');
    s = s.replace(/\\dot\s*\{([^{}]+)\}/g, '\\dot{$1}');
    s = s.replace(/\\ddot\s*([A-Za-z][a-z]?)/g, '\\ddot{$1}');
    s = s.replace(/\\dot\s*([A-Za-z][a-z]?)/g, '\\dot{$1}');
    return s;
}

function transformOutsideMath(value, transform) {
    const source = String(value ?? '');
    const mathPattern = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g;
    let out = '';
    let last = 0;
    let match;
    while ((match = mathPattern.exec(source))) {
        out += transform(source.slice(last, match.index));
        out += match[0];
        last = mathPattern.lastIndex;
    }
    out += transform(source.slice(last));
    return out;
}

function normalizePlainTextMath(value) {
    let s = String(value ?? '');
    const bareMath = [];
    s = wrapBareLatexFunctions(s, bareMath);
    s = s.replace(/\\ddot\{([^{}]+)\}/g, (_, atom) => `${atom}:`);
    s = s.replace(/\\dot\{([^{}]+)\}/g, (_, atom) => `${atom}·`);
    s = applyLatexSymbols(s);
    s = normalizeDistanceSymbols(s);
    s = s.replace(/\\_/g, '＿');
    s = s.replace(/_{2,}/g, (m) => '＿'.repeat(Math.min(m.length, 6)));
    s = s.replace(/\\{2,}/g, (m) => '＿'.repeat(Math.min(m.length, 6)));
    s = s.replace(/\\quad|\\qquad|\\,/g, ' ');
    s = s.replace(/_\{([A-Za-z0-9+-]+)\}/g, (_, v) => subDigits(v));
    s = s.replace(/_(\d+[+-]?)/g, (_, v) => subDigits(v));
    s = s.replace(/([A-Za-z][a-z]?)(\d+)/g, (_, head, n) => head + subDigits(n));
    s = s.replace(/([A-Za-z][a-z]?\))(\d+)/g, (_, head, n) => head + subDigits(n));
    s = s.replace(/\^{([^}]+)}/g, (_, v) => superDigits(v));
    s = s.replace(/\^([0-9]*[+-])/g, (_, v) => superDigits(v));
    s = s.replace(/\^([+-])/g, (_, v) => superDigits(v));
    s = s.replace(/\^(\d+)/g, (_, v) => superDigits(v));
    s = s.replace(/\^°/g, '°');
    s = markFractions(s);
    s = restoreBareMathPlaceholders(s, bareMath);
    return s;
}

function wrapBareLatexFunctions(value, store) {
    let s = String(value ?? '');
    const sqrtBody = '((?:[^{}]|\\{[^{}]*\\})+)';
    s = s.replace(new RegExp(`\\(\\\\sqrt\\{${sqrtBody}\\}\\)\\s*\\/\\s*\\(([^()]+)\\)`, 'g'), (_, body, den) => (
        holdBareMath(store, `\\frac{\\sqrt{${body}}}{${den}}`)
    ));
    s = s.replace(new RegExp(`\\\\sqrt\\{${sqrtBody}\\}\\s*\\/\\s*\\(([^()]+)\\)`, 'g'), (_, body, den) => (
        holdBareMath(store, `\\frac{\\sqrt{${body}}}{${den}}`)
    ));
    s = s.replace(new RegExp(`\\\\sqrt\\{${sqrtBody}\\}\\s*\\/\\s*([A-Za-z0-9₀-₉⁰-⁹⁺⁻.]+)`, 'g'), (_, body, den) => (
        holdBareMath(store, `\\frac{\\sqrt{${body}}}{${den}}`)
    ));
    s = wrapLatexFractions(s, store);
    s = s.replace(new RegExp(`\\\\sqrt\\{${sqrtBody}\\}`, 'g'), (_, body) => holdBareMath(store, `\\sqrt{${body}}`));
    s = s.replace(/\\ce\{([^{}]+)\}/g, (_, body) => holdBareMath(store, `\\ce{${body}}`));
    return s;
}

function holdBareMath(store, tex) {
    const index = store.push(tex) - 1;
    return `⟦§${index}§⟧`;
}

function restoreBareMathPlaceholders(value, store) {
    return String(value ?? '').replace(/⟦§(\d+)§⟧/g, (_, index) => `\\(${store[Number(index)] || ''}\\)`);
}

function wrapLatexFractions(value, store) {
    const source = String(value ?? '');
    let out = '';
    let i = 0;
    while (i < source.length) {
        const match = source.slice(i).match(/^\\(?:dfrac|frac)\{/);
        if (!match) {
            out += source[i++];
            continue;
        }
        const numeratorStart = i + match[0].length - 1;
        const numerator = readBraceGroup(source, numeratorStart);
        if (!numerator || source[numerator.end + 1] !== '{') {
            out += source[i++];
            continue;
        }
        const denominator = readBraceGroup(source, numerator.end + 1);
        if (!denominator) {
            out += source[i++];
            continue;
        }
        const command = match[0].startsWith('\\dfrac') ? '\\dfrac' : '\\frac';
        out += holdBareMath(store, `${command}{${numerator.value}}{${denominator.value}}`);
        i = denominator.end + 1;
    }
    return out;
}

function normalizeChemText(text) {
    let h = String(text ?? '');
    h = applyLatexSymbols(h);
    h = normalizeLatexFunctions(h);
    h = normalizeDistanceSymbols(h);
    h = h.replace(/\\_/g, '＿');
    h = h.replace(/_{2,}/g, (m) => '＿'.repeat(Math.min(m.length, 6)));
    h = h.replace(/_\{([A-Za-z0-9+-]+)\}/g, (_, v) => subDigits(v));
    h = h.replace(/_(\d+[+-]?)/g, (_, v) => subDigits(v));
    h = normalizeLatexFunctions(h);
    h = h.replace(/\\{2,}/g, (m) => '＿'.repeat(Math.min(m.length, 6)));
    h = h.replace(/\\quad|\\qquad|\\,/g, ' ');
    h = h.replace(/\$([^$]+)\$/g, (_, expr) => normalizeFormula(expr));
    h = normalizeDistanceSymbols(h);
    h = h.replace(/([A-Za-z][a-z]?)(\d+)/g, (_, head, n) => head + subDigits(n));
    h = h.replace(/([A-Za-z][a-z]?\))(\d+)/g, (_, head, n) => head + subDigits(n));
    h = h.replace(/\^{([^}]+)}/g, (_, v) => superDigits(v));
    h = h.replace(/\^([0-9]*[+-])/g, (_, v) => superDigits(v));
    h = h.replace(/\^([+-])/g, (_, v) => superDigits(v));
    h = h.replace(/\^(\d+)/g, (_, v) => superDigits(v));
    h = h.replace(/\^°/g, '°');
    h = markFractions(h);
    return h;
}

function normalizeFormula(expr) {
    let f = String(expr ?? '');
    f = applyLatexSymbols(f);
    f = normalizeLatexFunctions(f);
    f = f.replace(/\\mathrm\{([^}]+)}/g, '$1');
    f = f.replace(/\\text\{([^}]+)}/g, '$1');
    f = f.replace(/\\ce\{([^}]+)}/g, '$1');
    f = f.replace(/\\left|\\right/g, '');
    f = f.replace(/\\quad|\\qquad|\\,/g, ' ');
    f = f.replace(/_\{([A-Za-z0-9+-]+)\}/g, (_, v) => subDigits(v));
    f = f.replace(/_(\d+[+-]?)/g, (_, v) => subDigits(v));
    f = normalizeLatexFunctions(f);
    f = f.replace(/[{}]/g, '');
    f = f.replace(/\s+/g, ' ');
    f = normalizeDistanceSymbols(f);
    f = f.replace(/([A-Za-z][a-z]?)(\d+)/g, (_, head, n) => head + subDigits(n));
    f = f.replace(/([A-Za-z][a-z]?\))(\d+)/g, (_, head, n) => head + subDigits(n));
    f = f.replace(/\^([0-9]*[+-])/g, (_, v) => superDigits(v));
    f = f.replace(/\^([+-])/g, (_, v) => superDigits(v));
    f = f.replace(/\^(\d+)/g, (_, v) => superDigits(v));
    f = f.replace(/\^°/g, '°');
    f = markFractions(f);
    return f.trim();
}

function normalizeLatexFunctions(value) {
    let s = String(value ?? '').replace(/\\\\(?=[A-Za-z])/g, '\\');
    const bareMath = [];
    for (let i = 0; i < 4; i++) {
        s = replaceLatexFractions(s);
        s = wrapLatexFractions(s, bareMath);
        s = s.replace(/\\sqrt\{([^{}]+)\}/g, (_, body) => `√(${body})`);
        s = s.replace(/\\ddot\{([^{}]+)\}/g, (_, body) => `${body}:`);
        s = s.replace(/\\dot\{([^{}]+)\}/g, (_, body) => `${body}·`);
    }
    s = s.replace(/\\ddot\s*([A-Za-z][a-z]?)/g, (_, atom) => `${atom}:`);
    s = s.replace(/\\dot\s*([A-Za-z][a-z]?)/g, (_, atom) => `${atom}·`);
    s = restoreBareMathPlaceholders(s, bareMath);
    return s;
}

function replaceLatexFractions(value) {
    const source = String(value ?? '');
    let out = '';
    let i = 0;
    while (i < source.length) {
        const match = source.slice(i).match(/^\\(?:dfrac|frac)\{/);
        if (!match) {
            out += source[i++];
            continue;
        }

        const numeratorStart = i + match[0].length - 1;
        const numerator = readBraceGroup(source, numeratorStart);
        if (!numerator) {
            out += source[i++];
            continue;
        }

        const denominatorStart = numerator.end + 1;
        if (source[denominatorStart] !== '{') {
            out += source[i++];
            continue;
        }
        const denominator = readBraceGroup(source, denominatorStart);
        if (!denominator) {
            out += source[i++];
            continue;
        }

        out += `⟦FRAC:${numerator.value}∕${denominator.value}⟧`;
        i = denominator.end + 1;
    }
    return out;
}

function readBraceGroup(source, openIndex) {
    if (source[openIndex] !== '{') return null;
    let depth = 0;
    let value = '';
    for (let i = openIndex; i < source.length; i++) {
        const ch = source[i];
        if (ch === '{') {
            if (depth > 0) value += ch;
            depth++;
            continue;
        }
        if (ch === '}') {
            depth--;
            if (depth === 0) return { value, end: i };
            value += ch;
            continue;
        }
        value += ch;
    }
    return null;
}

function markFractions(value) {
    let s = String(value ?? '');

    s = s.replace(/\(√\(([^()\n]+)\)\)\s*\/\s*\(([^()\n]+)\)/g, (_, radicand, den) => (
        `⟦FRAC:√(${radicand})∕${den}⟧`
    ));
    s = s.replace(/√\(([^()\n]+)\)\s*\/\s*\(([^()\n]+)\)/g, (_, radicand, den) => (
        `⟦FRAC:√(${radicand})∕${den}⟧`
    ));
    s = s.replace(/√\(([^()\n]+)\)\s*\/\s*([A-Za-z0-9₀-₉⁰-⁹⁺⁻.]+)/g, (_, radicand, den) => (
        `⟦FRAC:√(${radicand})∕${den}⟧`
    ));
    s = s.replace(/\(([^()\n]+)\)\s*\/\s*\(([^()\n]+)\)/g, (_, num, den) => (
        `⟦FRAC:${num}∕${den}⟧`
    ));
    s = s.replace(/([0-9.]+（[^）]+）)\s*\/\s*([0-9.]+（[^）]+）)/g, (_, num, den) => (
        `⟦FRAC:${num}∕${den}⟧`
    ));
    s = s.replace(/([A-Za-z0-9₀-₉⁰-⁹⁺⁻.]+（[^）]+）)\s*\/\s*([A-Za-z0-9₀-₉⁰-⁹⁺⁻.]+（[^）]+）)/g, (_, num, den) => (
        `⟦FRAC:${num}∕${den}⟧`
    ));
    for (let i = 0; i < 3; i++) {
        s = s.replace(/(\([^()\n]+\)|√\([^()\n]+\)|[A-Za-z0-9₀-₉⁰-⁹⁺⁻.]+)\s*\/\s*(\([^()\n]+\)|√\([^()\n]+\)|[A-Za-z0-9₀-₉⁰-⁹⁺⁻.]+)/g, (_, num, den) => {
            const cleanNum = stripOuterParens(num);
            const cleanDen = stripOuterParens(den);
            return `⟦FRAC:${cleanNum}∕${cleanDen}⟧`;
        });
    }
    return s;
}

function restoreFractions(value) {
    return String(value ?? '').replace(/⟦FRAC:(.*?)∕(.*?)⟧/g, (_, num, den) => (
        `<span class="frac"><span class="num">${num}</span><span class="den">${den}</span></span>`
    ));
}

function stripOuterParens(value) {
    const s = String(value ?? '').trim();
    return s.startsWith('(') && s.endsWith(')') ? s.slice(1, -1) : s;
}

function normalizeDistanceSymbols(value) {
    let s = String(value ?? '');
    s = s.replace(/\bd([A-Z])_([a-z])-([A-Z])_([a-z])/g, (_, a1, a2, b1, b2) => `d(${a1}${a2}-${b1}${b2})`);
    s = s.replace(/\bd([A-Z])_([a-z])-([A-Z][a-z]?)/g, (_, a1, a2, b) => `d(${a1}${a2}-${b})`);
    s = s.replace(/\bd([A-Z][a-z]?)-([A-Z])_([a-z])/g, (_, a, b1, b2) => `d(${a}-${b1}${b2})`);
    s = s.replace(/\bd([A-Z][a-z]?)-([A-Z][a-z]?)/g, (_, a, b) => `d(${a}-${b})`);
    s = s.replace(/\bd([A-Z][a-z]?)₋([A-Z][a-z]?)/g, (_, a, b) => `d(${a}-${b})`);
    return s;
}

function applyLatexSymbols(value) {
    let s = String(value ?? '').replace(/\\\\(?=[A-Za-z])/g, '\\');
    s = s.replace(/\^\{?\\circ\}?/g, '°');
    for (const [cmd, symbol] of LATEX_SYMBOLS) {
        s = s.replace(new RegExp('\\\\' + cmd + '\\b', 'g'), symbol);
    }
    return s;
}

function toSubText(value) {
    return [...String(value ?? '')].map(c => SUB[c] || SUB[c.toLowerCase()] || c).join('');
}

const LATEX_SYMBOLS = [
    ['rightleftharpoons', '⇌'], ['leftrightarrow', '↔'], ['rightarrow', '→'], ['leftarrow', '←'],
    ['to', '→'], ['gets', '←'], ['uparrow', '↑'], ['downarrow', '↓'], ['longrightarrow', '⟶'],
    ['Longrightarrow', '⟹'], ['Rightarrow', '⇒'], ['Leftarrow', '⇐'], ['Leftrightarrow', '⇔'],
    ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['Delta', 'Δ'],
    ['epsilon', 'ε'], ['varepsilon', 'ε'], ['zeta', 'ζ'], ['eta', 'η'], ['theta', 'θ'],
    ['Theta', 'Θ'], ['lambda', 'λ'], ['Lambda', 'Λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'],
    ['pi', 'π'], ['Pi', 'Π'], ['rho', 'ρ'], ['sigma', 'σ'], ['Sigma', 'Σ'], ['tau', 'τ'],
    ['phi', 'φ'], ['varphi', 'φ'], ['Phi', 'Φ'], ['omega', 'ω'], ['Omega', 'Ω'],
    ['neq', '≠'], ['ne', '≠'], ['leq', '≤'], ['le', '≤'], ['geq', '≥'], ['ge', '≥'],
    ['approx', '≈'], ['sim', '∼'], ['simeq', '≃'], ['equiv', '≡'], ['propto', '∝'],
    ['pm', '±'], ['mp', '∓'], ['times', '×'], ['div', '÷'], ['cdot', '·'], ['bullet', '•'],
    ['circ', '°'], ['degree', '°'], ['infty', '∞'], ['in', '∈'], ['notin', '∉'],
    ['subset', '⊂'], ['subseteq', '⊆'], ['supset', '⊃'], ['supseteq', '⊇'],
    ['therefore', '∴'], ['because', '∵'], ['forall', '∀'], ['exists', '∃'],
    ['angle', '∠'], ['perp', '⊥'], ['parallel', '∥'], ['nparallel', '∦'],
    ['ldots', '…'], ['cdots', '…'], ['dots', '…']
];

const SUB = {
    '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉',
    '+':'₊','-':'₋','=':'₌','(':'₍',')':'₎',
    'A':'ₐ','E':'ₑ','H':'ₕ','I':'ᵢ','J':'ⱼ','K':'ₖ','L':'ₗ','M':'ₘ','N':'ₙ','O':'ₒ',
    'P':'ₚ','R':'ᵣ','S':'ₛ','T':'ₜ','U':'ᵤ','V':'ᵥ','X':'ₓ',
    'a':'ₐ','e':'ₑ','h':'ₕ','i':'ᵢ','j':'ⱼ','k':'ₖ','l':'ₗ','m':'ₘ','n':'ₙ','o':'ₒ',
    'p':'ₚ','r':'ᵣ','s':'ₛ','t':'ₜ','u':'ᵤ','v':'ᵥ','x':'ₓ'
};
function subDigits(s) { return [...s].map(c => SUB[c] || c).join(''); }
const SUP = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻' };
function superDigits(s) { return [...s].map(c => SUP[c] || c).join(''); }

async function loadQuestions() {
    const el = document.getElementById('qaHistory');
    el.innerHTML = '<div class="empty-msg">加载中...</div>';
    const r = await fetch(`${API}/api/questions`, { credentials:'include' });
    const d = await r.json();
    qaCache = d.questions || [];
    if (!qaCache.length) { el.innerHTML = '<div class="empty-msg">暂无答疑记录</div>'; return; }
    el.innerHTML = qaCache.map(q => `
        <div class="history-row" onclick="viewAnswer('${q.id}')">
            <h4>${esc(q.subject)} · ${esc(q.student_name)} · ${esc(q.created_at)}</h4>
            <p>${esc(q.question_text||'图片答疑')} · 模型：${esc(q.model_name || '未配置/未保存')} · 追问 ${q.followups?.length || 0}</p>
            ${q.answer ? `<p>${esc(q.answer).slice(0, 80)}${q.answer.length > 80 ? '...' : ''}</p>` : '<p>回答内容未保存，建议重新提交这道题。</p>'}
        </div>
    `).join('');
}

async function viewAnswer(id) {
    if (!qaCache.length) await loadQuestions();
    const q = qaCache.find(x => x.id === id);
    if (!q) return;
    currentQuestionId = id;
    document.getElementById('qaModel').textContent = q.model_name || '未配置/未保存';
    document.getElementById('qaAnswer').innerHTML = renderQuestionConversation(q);
    document.getElementById('qaClearBtn').classList.remove('hidden');
    showFollowupBox(id);
    window.scrollTo({ top: 300, behavior: 'smooth' });
}

function renderQuestionConversation(q) {
    let html = q.answer ? renderAnswer(q.answer) : '<p>该记录暂无回答内容，可能是之前流式中断导致未保存。</p>';
    for (const item of (q.followups || [])) {
        html += `
            <div class="followup-entry">
                <div class="followup-question">追问：${esc(item.prompt)}</div>
                <div class="meta">${esc(item.author_name || '')} · ${esc(item.created_at || '')} · ${esc(item.model_name || '未配置/未保存')}</div>
                <div class="answer-content">${item.answer ? renderAnswer(item.answer) : '<p>这条追问暂无回答内容。</p>'}</div>
            </div>
        `;
    }
    return html;
}

function showFollowupBox(id) {
    currentQuestionId = id;
    document.getElementById('followupBox').classList.remove('hidden');
}

async function askFollowup() {
    if (!currentQuestionId) return toast('请先选择一条答疑记录', 'err');
    const textEl = document.getElementById('followupText');
    const prompt = textEl.value.trim();
    if (!prompt) return toast('请输入追问内容', 'err');

    const btn = document.getElementById('followupBtn');
    btn.disabled = true;
    btn.textContent = 'AI 正在回答...';
    document.getElementById('followupHint').textContent = '正在基于当前题目继续解答';

    const answerEl = document.getElementById('qaAnswer');
    const holder = document.createElement('div');
    holder.className = 'followup-entry';
    holder.innerHTML = `
        <div class="followup-question">追问：${esc(prompt)}</div>
        <div class="answer-content" id="activeFollowupAnswer">等待 AI 输出...</div>
    `;
    answerEl.appendChild(holder);

    try {
        const r = await fetch(`${API}/api/questions/${currentQuestionId}/followups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ prompt })
        });
        if (!r.ok) throw new Error((await r.json()).error || '追问失败');

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let rawText = '';
        const active = document.getElementById('activeFollowupAnswer');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop();
            for (const block of parts) {
                for (const line of block.split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const d = JSON.parse(line.slice(6));
                        if (d.t === 'c') {
                            rawText += d.c;
                            active.innerHTML = renderAnswer(rawText);
                        } else if (d.t === 'k') {
                            document.getElementById('followupHint').textContent = '深度思考中，正在组织追问答案';
                            if (!rawText) active.innerHTML = renderThinkingStatus(d.c);
                        } else if (d.t === 'e') {
                            rawText = d.c;
                            active.innerHTML = renderAnswer(d.c);
                        }
                    } catch(e) {}
                }
            }
        }

        textEl.value = '';
        toast('追问已保存', 'ok');
        await loadQuestions();
        viewAnswer(currentQuestionId);
    } catch(e) {
        toast(e.message, 'err');
    } finally {
        btn.disabled = false;
        btn.textContent = '继续追问';
        document.getElementById('followupHint').textContent = '追问会保存到当前题目记录里';
    }
}

function clearAnswer() {
    currentQuestionId = null;
    document.getElementById('qaModel').textContent = '等待提问';
    document.getElementById('qaAnswer').innerHTML = '拍下题目点击"开始答疑"，AI 会识别题目并给出完整的讲解。';
    document.getElementById('qaClearBtn').classList.add('hidden');
    document.getElementById('followupBox').classList.add('hidden');
    document.getElementById('followupText').value = '';
}

// ====== Helpers ======
function formatToday() {
    const d = new Date();
    const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日　${weekdays[d.getDay()]}`;
}
function esc(s) { return String(s??'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg, type) { const t = document.createElement('div'); t.className=`toast ${type}`; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),2600); }
function openModal(src) { document.getElementById('modalImg').src=src; document.getElementById('imgModal').classList.add('open'); }
function closeModal() { document.getElementById('imgModal').classList.remove('open'); }

document.addEventListener('keydown', e => {
    if (e.key==='Enter' && !document.getElementById('authPage').classList.contains('hidden')) {
        document.getElementById('form-login').classList.contains('active') ? login() : register();
    }
});
