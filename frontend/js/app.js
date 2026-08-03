const API = window.location.origin;
let me = null;
let cwFilter = '';
let hwFilter = '';
let qaCache = [];
let currentQuestionId = null;
let selectedHomeworkFiles = [];

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
    document.getElementById('mobileDispName').textContent = user.display_name || user.username;
    document.getElementById('heroName').textContent = user.display_name || user.username;
    document.getElementById('hwSubmitterName').textContent = user.display_name || user.username;
    document.getElementById('todayChip').textContent = formatToday();
    const tag = document.getElementById('roleTag');
    tag.textContent = user.role === 'teacher' ? '教师' : '学生';
    tag.className = `role-badge ${user.role}`;
    document.getElementById('cwDate').value = todayValue();
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
    const username = document.getElementById('regUser').value.trim(), password = document.getElementById('regPass').value, confirm = document.getElementById('regPassConfirm').value;
    if (!username||!password) return authErr('regErr','请填写用户名和密码');
    if (password !== confirm) return authErr('regErr','两次输入的密码不一致');
    const r = await fetch(`${API}/api/register`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({username,password}) });
    const d = await r.json();
    r.ok ? showApp(d.user) : authErr('regErr', d.error);
}

async function logout() {
    await fetch(`${API}/api/logout`, { method:'POST', credentials:'include' });
    me = null; showAuth();
}

// ====== Tabs ======
function switchTab(t) {
    ['home','courseware','homework','report','qa'].forEach((name) => {
        document.getElementById(`tab-${name}`).classList.toggle('active', name===t);
    });
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        const target = btn.getAttribute('onclick')?.match(/switchTab\('([^']+)'\)/)?.[1];
        btn.classList.toggle('active', target === t && !btn.classList.contains('muted-nav'));
    });
    if (t==='courseware') loadCourseware();
    if (t==='homework') loadHomeworks();
    if (t==='report') loadReport();
    if (t==='qa') loadQuestions();
    requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ====== Learning Report ======
async function loadReport(forceRefresh = false) {
    const body = document.getElementById('reportBody');
    if (!body) return;
    body.innerHTML = `<div class="empty-msg">${forceRefresh ? '正在重新生成学习报告...' : '正在读取上次学习报告...'}</div>`;
    const days = document.getElementById('reportDays')?.value || '7';
    const studentSelect = document.getElementById('reportStudent');
    const studentId = studentSelect && !studentSelect.classList.contains('hidden') ? studentSelect.value : '';
    const params = new URLSearchParams({ days });
    if (studentId) params.set('student_id', studentId);
    if (forceRefresh) params.set('refresh', '1');
    const r = await fetch(`${API}/api/report?${params.toString()}`, { credentials:'include' });
    const d = await r.json();
    if (!r.ok) {
        body.innerHTML = `<div class="empty-msg">${esc(d.error || '报告生成失败')}</div>`;
        return;
    }
    renderReportStudentSelect(d);
    body.innerHTML = renderReport(d);
}

function renderReportStudentSelect(data) {
    const select = document.getElementById('reportStudent');
    if (!select) return;
    const students = data.students || [];
    select.classList.toggle('hidden', !students.length);
    if (!students.length) return;
    const previous = select.value;
    select.innerHTML = [
        '<option value="">全部学生</option>',
        ...students.map(s => `<option value="${esc(String(s.id))}">${esc(s.name)}</option>`)
    ].join('');
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
}

function renderReport(data) {
    const s = data.summary || {};
    const weakTopics = data.weak_topics || [];
    const weakItems = data.weak_items || [];
    const courseware = data.recent_courseware || [];
    const suggestions = data.suggestions || [];
    const statusRows = Object.entries(data.homework_status || {});
    const aiReport = data.ai_report || '';
    return `
        <div class="report-hero">
            <div>
                <span class="report-kicker">${esc(data.range.start)} 至 ${esc(data.range.end)}</span>
                <h3>${esc(data.student.name)}的学习进度</h3>
                <p>${esc(s.progress_level || '')} · 活跃 ${s.active_days || 0} 天 · 答疑 ${s.qa_count || 0} 次 · 作业 ${s.homework_count || 0} 份 · ${data.from_cache ? '上次生成' : '刚刚生成'}</p>
                ${data.cache_generated_at ? `<p class="report-cache-note">生成时间：${esc(data.cache_generated_at)} · 模型：${esc(data.report_model || '未配置')}</p>` : ''}
            </div>
            <div class="report-score">
                <strong>${s.progress_score || 0}</strong>
                <span>进度分</span>
            </div>
        </div>

        <section class="report-ai-card">
            <div class="report-card-head">
                <h3>AI生成学习报告</h3>
                <span>${esc(data.report_model || '未配置')}</span>
            </div>
            <div class="report-ai-content">
                ${aiReport ? renderAnswer(aiReport) : `<p>${esc(data.report_error || 'AI报告暂未生成，下面保留规则统计结果。')}</p>`}
            </div>
        </section>

        <div class="report-metrics">
            ${reportMetric('课件学习', s.courseware_count || 0, '份')}
            ${reportMetric('作业打卡', s.homework_count || 0, '份')}
            ${reportMetric('已批改', s.reviewed_count || 0, '份')}
            ${reportMetric('待修改', s.revision_count || 0, '份')}
            ${reportMetric('AI答疑', s.qa_count || 0, '题')}
            ${reportMetric('继续追问', s.followup_count || 0, '次')}
        </div>

        <div class="report-grid">
            <section class="report-card">
                <div class="report-card-head"><h3>薄弱主题</h3><span>按答疑与错题关键词统计</span></div>
                ${weakTopics.length ? `
                    <div class="topic-list">
                        ${weakTopics.map(t => `<div><span>${esc(t.name)}</span><b>${t.count}</b></div>`).join('')}
                    </div>
                ` : '<div class="empty-msg compact">暂无明显薄弱主题，继续积累答疑和作业记录。</div>'}
            </section>

            <section class="report-card">
                <div class="report-card-head"><h3>错题与风险</h3><span>需要优先复盘</span></div>
                ${weakItems.length ? `
                    <div class="risk-list">
                        ${weakItems.map(item => `
                            <button onclick="switchTab('${item.type === '答疑错题' ? 'qa' : 'homework'}')">
                                <strong>${esc(item.type)} · ${esc(item.time || '')}</strong>
                                <span>${esc(item.title || '')}</span>
                                <em>${esc((item.note || '').slice(0, 90))}${(item.note || '').length > 90 ? '...' : ''}</em>
                            </button>
                        `).join('')}
                    </div>
                ` : '<div class="empty-msg compact">这个周期没有明显错题风险。</div>'}
            </section>

            <section class="report-card">
                <div class="report-card-head"><h3>学习进度</h3><span>作业状态和课件覆盖</span></div>
                ${statusRows.length ? `<div class="status-bars">${statusRows.map(([name, count]) => reportStatusBar(name, count, s.homework_count || 1)).join('')}</div>` : '<div class="empty-msg compact">暂无作业状态数据。</div>'}
                ${courseware.length ? `<div class="course-mini">${courseware.map(c => `<div><b>${esc(c.date)}</b><span>${esc(c.title)}</span></div>`).join('')}</div>` : ''}
            </section>

            <section class="report-card">
                <div class="report-card-head"><h3>下一步建议</h3><span>本周期行动清单</span></div>
                <ul class="suggestion-list">${suggestions.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
            </section>
        </div>
    `;
}

function reportMetric(label, value, unit) {
    return `<div><span>${esc(label)}</span><strong>${esc(String(value))}</strong><em>${esc(unit)}</em></div>`;
}

function reportStatusBar(name, count, total) {
    const pct = Math.round((count / Math.max(total, 1)) * 100);
    return `<div><div><span>${esc(name)}</span><b>${count}份</b></div><i><em style="width:${pct}%"></em></i></div>`;
}

function activateHomeCard(event, tab) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    switchTab(tab);
}

// ====== Courseware ======
function filterCourseware(date) {
    cwFilter = date;
    loadCourseware();
}

async function loadCourseware() {
    const el = document.getElementById('cwList');
    el.innerHTML = '<div class="empty-msg">加载中...</div>';
    const url = cwFilter ? `${API}/api/courseware?date=${encodeURIComponent(cwFilter)}` : `${API}/api/courseware`;
    const r = await fetch(url, { credentials:'include' });
    const d = await r.json();
    renderCoursewareDateFilter(d.dates || []);
    if (!d.coursewares.length) { el.innerHTML = '<div class="empty-msg">暂无课件</div>'; return; }
    el.innerHTML = d.coursewares.map(c => `
        <div class="cw-card">
            <div>
                <h3>${esc(c.title)}</h3>
                <p class="meta">化学 · ${esc(formatDateLabel(c.course_date))} · ${esc(c.original_name)} · 上传于 ${esc(c.upload_time)}</p>
            </div>
            <div style="display:flex;gap:6px;">
                <a href="${API}/uploads/${esc(c.filename)}" target="_blank" class="btn btn-primary btn-small" style="text-decoration:none;">查看</a>
                ${me.role==='teacher' ? `<button class="btn btn-danger btn-small" onclick="delCw('${c.id}')">删</button>` : ''}
            </div>
        </div>
    `).join('');
}

function renderCoursewareDateFilter(dates) {
    const filter = document.getElementById('cwSubjectFilter');
    const items = ['<button class="subject-chip" onclick="filterCourseware(\'\')">最近</button>']
        .concat(dates.map(day => `<button class="subject-chip" onclick="filterCourseware('${esc(day)}')">${esc(formatDateLabel(day))}</button>`));
    filter.innerHTML = items.join('');
    filter.querySelectorAll('.subject-chip').forEach((chip, idx) => {
        const active = idx === 0 ? !cwFilter : chip.textContent === formatDateLabel(cwFilter);
        chip.classList.toggle('active', active);
    });
}

async function uploadCourseware() {
    const title = document.getElementById('cwTitle').value.trim();
    const courseDate = document.getElementById('cwDate').value || todayValue();
    const file = document.getElementById('cwFile').files[0];
    if (!title) return toast('请输入标题','err');
    if (!courseDate) return toast('请选择日期','err');
    if (!file) return toast('请选择文件','err');
    const fd = new FormData();
    fd.append('title', title); fd.append('course_date', courseDate); fd.append('file', file);
    const r = await fetch(`${API}/api/courseware/upload`, { method:'POST', credentials:'include', body: fd });
    const d = await r.json();
    if (r.ok) {
        document.getElementById('cwTitle').value='';
        document.getElementById('cwFile').value='';
        updateCoursewareFileName();
        cwFilter = courseDate;
        loadCourseware();
    }
    toast(d.message||d.error, r.ok?'ok':'err');
}

function updateCoursewareFileName() {
    const file = document.getElementById('cwFile').files[0];
    document.getElementById('cwFileName').textContent = file ? file.name : '还没有选择文件';
}

async function delCw(id) {
    if (!confirm('确定删除？')) return;
    const r = await fetch(`${API}/api/courseware/${id}`, { method:'DELETE', credentials:'include' });
    const d = await r.json();
    if (r.ok) loadCourseware();
    toast(d.message||d.error, r.ok?'ok':'err');
}

// ====== Homework ======
function filterHomeworks(subject) {
    hwFilter = subject;
    loadHomeworks();
}

function renderHomeworkFilter() {
    document.querySelectorAll('#hwSubjectFilter .subject-chip').forEach(chip => {
        const text = chip.textContent.trim();
        chip.classList.toggle('active', hwFilter ? text === hwFilter : text === '全部');
    });
}

function renderHomeworkPreview() {
    const list = document.getElementById('hwPreviewList');
    if (!selectedHomeworkFiles.length) {
        list.innerHTML = '';
        list.classList.add('hidden');
        document.getElementById('hwUploadHint').classList.remove('hidden');
        return;
    }
    list.innerHTML = selectedHomeworkFiles.map((file, idx) => `
        <div class="hw-preview-item" onclick="event.stopPropagation()">
            <img src="${URL.createObjectURL(file)}" alt="作业图片${idx + 1}">
            <span>${idx + 1}</span>
            <button type="button" class="hw-preview-remove" onclick="removeHomeworkPreview(event, ${idx})">×</button>
        </div>
    `).join('');
    list.classList.remove('hidden');
    document.getElementById('hwUploadHint').classList.add('hidden');
}

function removeHomeworkPreview(event, index) {
    event.stopPropagation();
    selectedHomeworkFiles.splice(index, 1);
    renderHomeworkPreview();
}

function clearHomeworkSelection() {
    selectedHomeworkFiles = [];
    document.getElementById('hwFile').value = '';
    renderHomeworkPreview();
}

function previewHw(e) {
    const files = [...e.target.files];
    if (!files.length) return;
    for (const file of files) {
        const exists = selectedHomeworkFiles.some(item =>
            item.name === file.name && item.size === file.size && item.lastModified === file.lastModified
        );
        if (!exists) selectedHomeworkFiles.push(file);
    }
    e.target.value = '';
    renderHomeworkPreview();
}

async function uploadHomework() {
    const subject = document.getElementById('hwSubject').value;
    const files = selectedHomeworkFiles;
    if (!files.length) return toast('请选择图片','err');
    if (files.length > 30) return toast('一次最多上传30张图片','err');
    const fd = new FormData();
    fd.append('subject', subject);
    files.forEach(file => fd.append('files', file));
    const r = await fetch(`${API}/api/homeworks/upload`, { method:'POST', credentials:'include', body: fd });
    const d = await r.json();
    if (r.ok) {
        clearHomeworkSelection();
        loadHomeworks();
    }
    toast(d.message||d.error, r.ok?'ok':'err');
}

async function loadHomeworks() {
    const el = document.getElementById('hwList');
    el.innerHTML = '<div class="empty-msg">加载中...</div>';
    renderHomeworkFilter();
    const url = hwFilter ? `${API}/api/homeworks?subject=${encodeURIComponent(hwFilter)}` : `${API}/api/homeworks`;
    const r = await fetch(url, { credentials:'include' });
    const d = await r.json();
    if (!d.homeworks.length) {
        el.innerHTML = `<div class="empty-msg">${hwFilter ? `暂无${esc(hwFilter)}作业记录` : '暂无作业记录'}</div>`;
        return;
    }
    el.innerHTML = `<div class="hw-grid">${d.homeworks.map(h => hwCard(h)).join('')}</div>`;
}

function hwCard(h) {
    const sc = { '待批改':'pending','批改中':'reviewing','已批改':'done','已完成':'done','待修改':'pending' }[h.status]||'pending';
    const deleteBtn = `<button class="btn btn-danger btn-small hw-delete-btn" onclick="deleteHw('${h.id}')">删除</button>`;
    const images = (h.filenames && h.filenames.length ? h.filenames : [h.filename]).filter(Boolean);
    const imageGridClass = images.length > 1 ? 'multi' : 'single';
    const imageGrid = `<div class="hw-image-grid ${imageGridClass}">
        ${images.map((filename, idx) => `
            <button class="hw-image-thumb" onclick="openModal('${API}/uploads/${esc(filename)}')" title="查看第${idx + 1}张">
                <img src="${API}/uploads/${esc(filename)}" alt="作业图片${idx + 1}">
                ${images.length > 1 ? `<span>${idx + 1}</span>` : ''}
            </button>
        `).join('')}
    </div>`;
    const tools = me.role==='teacher' ? `
        <div class="hw-actions">
            <button class="btn btn-success btn-small" onclick="reviewHw('${h.id}','已批改')">通过</button>
            <button class="btn btn-warning btn-small" onclick="reviewHw('${h.id}','批改中')">批改中</button>
            <button class="btn btn-danger btn-small" onclick="reviewHw('${h.id}','待修改')">需修改</button>
            ${deleteBtn}
        </div>
        <textarea id="cmt-${h.id}" class="form-group" style="margin-top:6px;min-height:50px;" placeholder="评语">${esc(h.comment||'')}</textarea>
        <button class="btn btn-primary btn-small btn-block" onclick="saveCmt('${h.id}')">保存评语</button>
    ` : `
        ${h.comment ? `<p class="meta">评语：${esc(h.comment)}</p>` : ''}
        <div class="hw-actions">${deleteBtn}</div>
    `;
    return `<div class="hw-card">
        ${imageGrid}
        <h3>${esc(h.student_name)} · ${esc(h.subject)}</h3>
        <p class="meta">${esc(h.upload_time)} · ${images.length}张 <span class="status-tag ${sc}">${esc(h.status)}</span></p>
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

async function deleteHw(id) {
    if (!confirm('确定删除这条打卡作业和全部图片？')) return;
    const r = await fetch(`${API}/api/homeworks/${id}`, { method:'DELETE', credentials:'include' });
    const d = await r.json();
    if (r.ok) loadHomeworks();
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
    const questionText = document.getElementById('qaText').value.trim();
    if (!file && !questionText) return toast('请上传题目图片，或输入需要答疑的问题','err');
    const btn = document.getElementById('qaBtn');
    btn.disabled = true; btn.textContent = 'AI 正在解题...';
    document.getElementById('qaModel').textContent = '思考中';
    document.getElementById('qaAnswer').innerHTML = '';
    document.getElementById('qaClearBtn').classList.add('hidden');

    const fd = new FormData();
    fd.append('subject', document.getElementById('qaSubject').value);
    fd.append('question_text', questionText);
    if (file) fd.append('file', file);

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
                            answerEl.innerHTML = renderAnswer(rawText, { typeset: false });
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
                            if (rawText) answerEl.innerHTML = renderAnswer(rawText);
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

        if (rawText) answerEl.innerHTML = renderAnswer(rawText);
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

function renderAnswer(text, options = {}) {
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
    if (options.typeset !== false) scheduleMathTypeset();
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
    updateQuestionDateFilter();
    renderQuestionsHistory();
}

function renderQuestionsHistory() {
    const el = document.getElementById('qaHistory');
    if (!el) return;
    if (!qaCache.length) { el.innerHTML = '<div class="empty-msg">暂无答疑记录</div>'; return; }
    const selectedDate = document.getElementById('qaHistoryDate')?.value || '';
    const visible = selectedDate ? qaCache.filter(q => (q.created_at || '').slice(0, 10) === selectedDate) : qaCache;
    if (!visible.length) { el.innerHTML = '<div class="empty-msg">这一天暂无答疑记录</div>'; return; }
    const groups = groupQuestionsByDay(visible);
    el.innerHTML = groups.map(group => `
        <section class="history-day">
            <div class="history-day-head">
                <h3>${esc(group.label)}</h3>
                <span>${group.items.length} 条答疑</span>
            </div>
            <div class="history-day-list">
                ${group.items.map(q => qaHistoryRow(q)).join('')}
            </div>
        </section>
    `).join('');
}

function updateQuestionDateFilter() {
    const select = document.getElementById('qaHistoryDate');
    if (!select) return;
    const previous = select.value;
    const groups = groupQuestionsByDay(qaCache);
    select.innerHTML = [
        '<option value="">全部日期</option>',
        ...groups.map(group => `<option value="${esc(group.key)}">${esc(group.label)}（${group.items.length}条）</option>`)
    ].join('');
    if ([...select.options].some(option => option.value === previous)) {
        select.value = previous;
    }
}

function groupQuestionsByDay(items) {
    const map = new Map();
    items.forEach(q => {
        const key = (q.created_at || '').slice(0, 10) || '未记录日期';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(q);
    });
    return Array.from(map.entries()).map(([key, groupItems]) => ({
        key,
        label: formatQaDayLabel(key),
        items: groupItems
    }));
}

function formatQaDayLabel(key) {
    if (key === '未记录日期') return key;
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const todayKey = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayKey = `${yesterday.getFullYear()}-${pad(yesterday.getMonth()+1)}-${pad(yesterday.getDate())}`;
    if (key === todayKey) return `今天 · ${key}`;
    if (key === yesterdayKey) return `昨天 · ${key}`;
    return key;
}

function qaHistoryRow(q) {
    const time = (q.created_at || '').slice(11, 16) || '--:--';
    const title = q.question_text || '图片答疑';
    return `
        <div class="history-row" onclick="viewAnswer('${q.id}')">
            <h4>${esc(time)} · ${esc(q.subject)} · ${esc(q.student_name)}</h4>
            <p>${esc(title)} · 模型：${esc(q.model_name || '未配置/未保存')} · 追问 ${q.followups?.length || 0}</p>
            ${q.answer ? `<p>${esc(q.answer).slice(0, 80)}${q.answer.length > 80 ? '...' : ''}</p>` : '<p>回答内容未保存，建议重新提交这道题。</p>'}
        </div>
    `;
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
    document.querySelector('.answer-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                            active.innerHTML = renderAnswer(rawText, { typeset: false });
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

        if (rawText) active.innerHTML = renderAnswer(rawText);
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
    document.getElementById('qaAnswer').innerHTML = '上传题目图片或直接输入问题，点击"开始答疑"后 AI 会给出讲解。';
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
function todayValue() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}
function formatDateLabel(value) {
    if (!value) return '';
    const [year, month, day] = String(value).split('-');
    if (!year || !month || !day) return String(value);
    return `${Number(month)}月${Number(day)}日`;
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
