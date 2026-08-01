from flask import Flask, request, jsonify, send_from_directory, session, Response, stream_with_context
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
import base64
import json
import mimetypes
import os
import requests
import uuid
from datetime import datetime, timedelta
from functools import wraps
from io import BytesIO
from sqlalchemy import inspect, or_, text

try:
    from PIL import Image, ImageOps
except ImportError:
    Image = None
    ImageOps = None

app = Flask(__name__, static_folder='../frontend')
app.secret_key = 'tutor-secret-key-2024'
DB_PATH = os.getenv('DATABASE_PATH', os.path.join(os.path.dirname(__file__), 'tutor.db'))
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + DB_PATH
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=7)

CORS(app, supports_credentials=True)
db = SQLAlchemy(app)
bcrypt = Bcrypt(app)

UPLOAD_FOLDER = os.getenv('UPLOAD_FOLDER', os.path.join(os.path.dirname(__file__), '..', 'uploads'))
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

ALLOWED_IMAGE = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'}
ALLOWED_COURSEWARE = {'pdf', 'ppt', 'pptx', 'doc', 'docx', 'jpg', 'jpeg', 'png'}
MAX_FILE_SIZE = 20 * 1024 * 1024

# ====== 模型 ======

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), default='student')
    display_name = db.Column(db.String(50), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Courseware(db.Model):
    __tablename__ = 'coursewares'
    id = db.Column(db.Integer, primary_key=True)
    uid = db.Column(db.String(12), unique=True, nullable=False)
    title = db.Column(db.String(200), nullable=False)
    subject = db.Column(db.String(50), nullable=False)
    course_date = db.Column(db.String(20), nullable=True)
    filename = db.Column(db.String(200), nullable=False)
    original_name = db.Column(db.String(200), nullable=False)
    upload_time = db.Column(db.String(30), nullable=False)
    uploaded_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

class Homework(db.Model):
    __tablename__ = 'homeworks'
    id = db.Column(db.Integer, primary_key=True)
    uid = db.Column(db.String(12), unique=True, nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    student_name = db.Column(db.String(80), nullable=False)
    subject = db.Column(db.String(50), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    upload_time = db.Column(db.String(30), nullable=False)
    status = db.Column(db.String(20), default='待批改')
    comment = db.Column(db.Text, default='')
    reviewed_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

class Question(db.Model):
    __tablename__ = 'questions'
    id = db.Column(db.Integer, primary_key=True)
    uid = db.Column(db.String(12), unique=True, nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    student_name = db.Column(db.String(80), nullable=False)
    subject = db.Column(db.String(50), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    question_text = db.Column(db.Text, default='')
    answer = db.Column(db.Text, default='')
    model_name = db.Column(db.String(80), default='')
    created_at = db.Column(db.String(30), nullable=False)

class QuestionFollowup(db.Model):
    __tablename__ = 'question_followups'
    id = db.Column(db.Integer, primary_key=True)
    uid = db.Column(db.String(12), unique=True, nullable=False)
    question_id = db.Column(db.Integer, db.ForeignKey('questions.id'), nullable=False)
    asked_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    author_name = db.Column(db.String(80), nullable=False)
    prompt = db.Column(db.Text, default='')
    answer = db.Column(db.Text, default='')
    model_name = db.Column(db.String(80), default='')
    created_at = db.Column(db.String(30), nullable=False)

# ====== 初始化 ======

with app.app_context():
    db.create_all()
    cw_columns = {col['name'] for col in inspect(db.engine).get_columns('coursewares')}
    if 'course_date' not in cw_columns:
        db.session.execute(text('ALTER TABLE coursewares ADD COLUMN course_date VARCHAR(20)'))
        db.session.commit()
    for username, pwd, role, display in [
        ('teacher', 'admin123', 'teacher', '张老师'),
        ('student1', '123456', 'student', '小明'),
    ]:
        if not User.query.filter_by(username=username).first():
            db.session.add(User(username=username, password_hash=bcrypt.generate_password_hash(pwd).decode('utf-8'), role=role, display_name=display))
    db.session.commit()

# ====== 序列化 ======

def ser_cw(c):
    return {'id': c.uid, 'title': c.title, 'subject': c.subject, 'course_date': c.course_date or c.upload_time[:10], 'filename': c.filename, 'original_name': c.original_name, 'upload_time': c.upload_time}

def ser_hw(h):
    return {'id': h.uid, 'student_name': h.student_name, 'subject': h.subject, 'filename': h.filename, 'upload_time': h.upload_time, 'status': h.status, 'comment': h.comment}

def ser_qa(q):
    followups = QuestionFollowup.query.filter_by(question_id=q.id).order_by(QuestionFollowup.id.asc()).all()
    return {
        'id': q.uid,
        'student_name': q.student_name,
        'subject': q.subject,
        'filename': q.filename,
        'question_text': q.question_text,
        'answer': q.answer,
        'model_name': q.model_name,
        'created_at': q.created_at,
        'followups': [ser_followup(f) for f in followups]
    }

def ser_followup(f):
    return {
        'id': f.uid,
        'author_name': f.author_name,
        'prompt': f.prompt,
        'answer': f.answer,
        'model_name': f.model_name,
        'created_at': f.created_at
    }

# ====== LLM ======

def env_flag(name, default='1'):
    return os.getenv(name, default).strip().lower() not in {'0', 'false', 'no', 'off'}

def env_int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default

def encode_image_for_llm(image_path):
    max_side = env_int('LLM_IMAGE_MAX_SIDE', 1600)
    quality = env_int('LLM_IMAGE_QUALITY', 85)

    if not Image or not ImageOps:
        mime_type = mimetypes.guess_type(image_path)[0] or 'image/jpeg'
        with open(image_path, 'rb') as f:
            return mime_type, base64.b64encode(f.read()).decode('utf-8')

    try:
        with Image.open(image_path) as img:
            img = ImageOps.exif_transpose(img)
            img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
            if img.mode not in ('RGB', 'L'):
                img = img.convert('RGB')
            out = BytesIO()
            img.save(out, format='JPEG', quality=quality, optimize=True)
            return 'image/jpeg', base64.b64encode(out.getvalue()).decode('utf-8')
    except Exception:
        mime_type = mimetypes.guess_type(image_path)[0] or 'image/jpeg'
        with open(image_path, 'rb') as f:
            return mime_type, base64.b64encode(f.read()).decode('utf-8')

def build_payload_from_prompt(image_path, prompt):
    api_key = os.getenv('LLM_API_KEY')
    base_url = os.getenv('LLM_BASE_URL', '').rstrip('/')
    model = os.getenv('LLM_MODEL', 'qwen3.7-plus')
    if not api_key or not base_url:
        return None, None, None, '未配置大模型 API Key'

    mime_type, encoded = encode_image_for_llm(image_path)

    high_accuracy = env_flag('LLM_HIGH_ACCURACY', '1')
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': prompt},
            {'type': 'image_url', 'image_url': {'url': f'data:{mime_type};base64,{encoded}'}}
        ]}],
        'temperature': 0.1 if high_accuracy else 0.2,
        'max_tokens': env_int('LLM_MAX_TOKENS', 2200 if high_accuracy else 1800)
    }
    if env_flag('LLM_ENABLE_THINKING', '1'):
        payload['enable_thinking'] = True
        payload['thinking_budget'] = env_int('LLM_THINKING_BUDGET', 1200 if high_accuracy else 800)
    return base_url, api_key, model, payload

def build_vision_payload(image_path, subject, question_text):
    prompt = (
        '你是一位高效、准确的高中化学家教。请识别题目图片并解答，要求：\n'
        '1. 不要长篇复述题干，只提取解题必须信息；图片不清楚时直接指出。\n'
        '2. 必须展示给学生看的推理过程：条件提取、公式/原理选择、关键判断、必要计算。\n'
        '3. 选择题只分析关键选项；计算题保留关键公式和代入过程。\n'
        '4. 化学式、离子、电荷、分数、反应箭头要用规范可读写法。\n\n'
        '遇到复杂晶胞或有机推断题，要先自查关键风险点：晶胞粒子数/配位数/密度公式，'
        '有机题的不饱和度/官能团/反应类型/同分异构，不能确定时明确说明不确定原因。\n\n'
        '请用以下结构回答：\n'
        '## 识别\n一句话概括题型和已知条件。\n\n'
        '## 推理过程\n3-6步讲清条件怎么用、为什么选这个方法、怎么算到答案。\n\n'
        '## 答案\n给出最终答案。\n\n'
        '## 易错点\n最多2条。'
        f'\n\n科目：{subject}\n孩子的问题：{question_text or "请完整讲解"}'
    )
    return build_payload_from_prompt(image_path, prompt)

def build_followup_payload(question, followups, prompt):
    previous = []
    if question.question_text:
        previous.append(f'学生最初的问题：{question.question_text}')
    if question.answer:
        previous.append(f'上一轮讲解摘要：\n{question.answer[:1800]}')
    for item in followups[-6:]:
        previous.append(f'追问：{item.prompt}\n回答摘要：{item.answer[:900]}')

    full_prompt = (
        '你是一位耐心的高中化学家教。学生正在针对同一道题继续追问。'
        '请结合题目图片、前面的讲解和追问上下文回答，不要重新识别整道题，'
        '只回答这次追问。回答要短、准、分步骤，并展示给学生看的关键推理过程，公式显示尽量简洁。\n\n'
        + '\n\n'.join(previous)
        + f'\n\n本次追问：{prompt}\n\n'
        '请按以下结构回答：\n'
        '## 追问回答\n直接回答这次问题。\n\n'
        '## 推理过程\n解释关键原因、条件怎么用、必要推理或计算。\n\n'
        '## 小提醒\n一句话指出容易混淆点。'
    )
    return build_payload_from_prompt(os.path.join(UPLOAD_FOLDER, question.filename), full_prompt)

def post_llm_stream(base_url, api_key, payload):
    try:
        res = requests.post(
            f'{base_url}/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json=payload, stream=True, timeout=120
        )
        res.raise_for_status()
        return res
    except requests.HTTPError:
        if 'enable_thinking' not in payload and 'thinking_budget' not in payload:
            raise
        fallback = dict(payload)
        fallback.pop('enable_thinking', None)
        fallback.pop('thinking_budget', None)
        res = requests.post(
            f'{base_url}/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json=fallback, stream=True, timeout=120
        )
        res.raise_for_status()
        return res

def build_verifier_payload(payload, draft_answer):
    verifier_prompt = (
        '请作为高考化学阅卷老师，对上面的初版答案进行严格复核。'
        '重点检查复杂晶胞、有机推断、结构式、化学计量、单位和选项判断。'
        '如果题目属于晶胞/结构化学，请逐项核对：晶胞中粒子数、配位数、最近距离、密度公式、'
        '坐标/投影图识别、价电子/杂化/空间构型。'
        '如果题目属于有机推断，请逐项核对：分子式、不饱和度、官能团、反应类型、'
        '同分异构、条件选择、氧化/还原/取代/加成关系。'
        '如果图片或题干信息不足，不要硬猜，要明确说需要更清晰图片或补充条件。\n\n'
        '输出要求：\n'
        '1. 如果初版答案正确，只输出：## 校验结论，然后用2-4条说明关键校验点。\n'
        '2. 如果发现错误或不严谨，只输出：## 校验修正，指出错误点，并给出修正后的关键推理和最终答案。\n'
        '3. 不要重复整篇初版答案，不要输出内部思考草稿。'
    )
    verifier_payload = dict(payload)
    verifier_payload['messages'] = list(payload.get('messages', [])) + [
        {'role': 'assistant', 'content': draft_answer[-5000:]},
        {'role': 'user', 'content': verifier_prompt}
    ]
    verifier_payload['temperature'] = 0
    verifier_payload['max_tokens'] = env_int('LLM_VERIFY_MAX_TOKENS', 1200)
    if env_flag('LLM_ENABLE_THINKING', '1'):
        verifier_payload['enable_thinking'] = True
        verifier_payload['thinking_budget'] = env_int('LLM_VERIFY_THINKING_BUDGET', 1000)
    return verifier_payload

def yield_llm_chunks(res, model, full=None, emit_done=True):
    if full is None:
        full = []
    thinking_sent = False
    for line in res.iter_lines(decode_unicode=True):
        if not line or not line.startswith('data: '):
            continue
        data_str = line[6:]
        if data_str == '[DONE]':
            break
        try:
            chunk = json.loads(data_str)
            delta = chunk['choices'][0].get('delta', {})
            reasoning = delta.get('reasoning_content', '')
            if reasoning and not thinking_sent:
                thinking_sent = True
                yield f"data: {json.dumps({'t': 'k', 'c': '深度思考已开启：正在识别题目、提取条件、选择化学原理并组织可读推理过程...'}, ensure_ascii=False)}\n\n"

            content = delta.get('content', '')
            if content:
                full.append(content)
                yield f"data: {json.dumps({'t': 'c', 'c': content}, ensure_ascii=False)}\n\n"
        except (json.JSONDecodeError, KeyError, IndexError):
            pass

    if emit_done:
        yield f"data: {json.dumps({'t': 'd', 'm': model, 'f': ''.join(full)}, ensure_ascii=False)}\n\n"

def stream_with_accuracy_check(base_url, api_key, model, payload):
    answer_parts = []
    res = post_llm_stream(base_url, api_key, payload)
    for event in yield_llm_chunks(res, model, answer_parts, emit_done=False):
        yield event

    if env_flag('LLM_HIGH_ACCURACY', '1') and ''.join(answer_parts).strip():
        yield f"data: {json.dumps({'t': 'k', 'c': '进入高准确复核：正在二次检查晶胞计数、有机推断、公式单位和最终答案...'}, ensure_ascii=False)}\n\n"
        verifier_payload = build_verifier_payload(payload, ''.join(answer_parts))
        verifier_payload['stream'] = True
        verifier_res = post_llm_stream(base_url, api_key, verifier_payload)
        answer_parts.append('\n\n')
        yield f"data: {json.dumps({'t': 'c', 'c': '\\n\\n'}, ensure_ascii=False)}\n\n"
        for event in yield_llm_chunks(verifier_res, model, answer_parts, emit_done=False):
            yield event

    yield f"data: {json.dumps({'t': 'd', 'm': model, 'f': ''.join(answer_parts)}, ensure_ascii=False)}\n\n"

def ask_vision_model_stream(image_path, subject, question_text):
    """Generator that yields SSE event strings"""
    base_url, api_key, model, payload = build_vision_payload(image_path, subject, question_text)
    if base_url is None:
        yield f"data: {json.dumps({'t': 'e', 'c': payload}, ensure_ascii=False)}\n\n"
        return

    payload['stream'] = True
    try:
        for event in stream_with_accuracy_check(base_url, api_key, model, payload):
            yield event

    except Exception as e:
        yield f"data: {json.dumps({'t': 'e', 'c': f'调用失败: {str(e)}'}, ensure_ascii=False)}\n\n"

def stream_payload(payload_builder):
    try:
        base_url, api_key, model, payload = payload_builder()
    except Exception as e:
        yield f"data: {json.dumps({'t': 'e', 'c': f'调用失败: {str(e)}'}, ensure_ascii=False)}\n\n"
        return

    if base_url is None:
        yield f"data: {json.dumps({'t': 'e', 'c': payload}, ensure_ascii=False)}\n\n"
        return

    payload['stream'] = True
    try:
        for event in stream_with_accuracy_check(base_url, api_key, model, payload):
            yield event

    except Exception as e:
        yield f"data: {json.dumps({'t': 'e', 'c': f'调用失败: {str(e)}'}, ensure_ascii=False)}\n\n"

def ask_vision_model(image_path, subject, question_text):
    """Non-streaming version - returns (answer, model_name)"""
    base_url, api_key, model, payload_or_error = build_vision_payload(image_path, subject, question_text)
    if base_url is None:
        return payload_or_error, '未配置'

    res = requests.post(f'{base_url}/chat/completions',
        headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
        json=payload_or_error, timeout=120)
    res.raise_for_status()
    return res.json()['choices'][0]['message']['content'], model

# ====== 装饰器 ======

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': '请先登录'}), 401
        return f(*args, **kwargs)
    return decorated

def teacher_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': '请先登录'}), 401
        if User.query.get(session['user_id']).role != 'teacher':
            return jsonify({'error': '仅教师可操作'}), 403
        return f(*args, **kwargs)
    return decorated

# ====== 认证 ======

@app.route('/')
def index():
    return send_from_directory('../frontend', 'index.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username', '').strip()
    password = data.get('password', '')
    display_name = username
    if not username or not password: return jsonify({'error': '请填写用户名和密码'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'error': '用户名已存在'}), 409

    user = User(username=username, password_hash=bcrypt.generate_password_hash(password).decode('utf-8'), role='student', display_name=display_name)
    db.session.add(user)
    db.session.commit()
    session['user_id'] = user.id; session['username'] = user.username; session['role'] = user.role; session['display_name'] = user.display_name
    session.permanent = True
    return jsonify({'message': '注册成功', 'user': {'id': user.id, 'username': user.username, 'display_name': user.display_name, 'role': user.role}}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(username=data.get('username', '').strip()).first()
    if not user or not bcrypt.check_password_hash(user.password_hash, data.get('password', '')):
        return jsonify({'error': '用户名或密码错误'}), 401
    session['user_id'] = user.id; session['username'] = user.username; session['role'] = user.role; session['display_name'] = user.display_name
    session.permanent = True
    return jsonify({'message': '登录成功', 'user': {'id': user.id, 'username': user.username, 'display_name': user.display_name, 'role': user.role}})

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'message': '已退出'})

@app.route('/api/me', methods=['GET'])
def me():
    if 'user_id' not in session: return jsonify({'user': None})
    u = User.query.get(session['user_id'])
    if not u: session.clear(); return jsonify({'user': None})
    return jsonify({'user': {'id': u.id, 'username': u.username, 'display_name': u.display_name, 'role': u.role}})

# ====== 课件 ======

@app.route('/api/courseware', methods=['GET'])
@login_required
def list_courseware():
    date_filter = request.args.get('date', '').strip()
    user = User.query.get(session['user_id'])
    q = Courseware.query.filter_by(subject='化学')
    if user.role == 'teacher':
        q = q.filter_by(uploaded_by=user.id)
    if date_filter:
        q = q.filter(or_(Courseware.course_date == date_filter, Courseware.upload_time.like(f'{date_filter}%')))
    records = q.order_by(Courseware.id.desc()).all()

    date_q = Courseware.query.filter_by(subject='化学')
    if user.role == 'teacher':
        date_q = date_q.filter_by(uploaded_by=user.id)
    date_records = date_q.order_by(Courseware.id.desc()).all()
    dates = []
    for item in date_records:
        day = item.course_date or item.upload_time[:10]
        if day and day not in dates:
            dates.append(day)

    if not date_filter:
        records = records[:8]
    return jsonify({'coursewares': [ser_cw(c) for c in records], 'dates': dates[:12]})

@app.route('/api/courseware/upload', methods=['POST'])
@teacher_required
def upload_courseware():
    title = request.form.get('title', '').strip()
    subject = '化学'
    course_date = request.form.get('course_date', '').strip() or datetime.now().strftime('%Y-%m-%d')
    file = request.files.get('file')
    if not title: return jsonify({'error': '请输入课件标题'}), 400
    if not course_date: return jsonify({'error': '请选择课程日期'}), 400
    if not file: return jsonify({'error': '请选择文件'}), 400

    ext = (file.filename.rsplit('.', 1)[-1] if '.' in file.filename else '').lower()
    if ext not in ALLOWED_COURSEWARE:
        return jsonify({'error': f'不支持的文件格式：{ext}'}), 400

    safe_name = f"cw_{uuid.uuid4().hex}.{ext}"
    file.save(os.path.join(UPLOAD_FOLDER, safe_name))

    cw = Courseware(uid=uuid.uuid4().hex[:8], title=title, subject=subject, course_date=course_date,
                    filename=safe_name, original_name=file.filename,
                    upload_time=datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                    uploaded_by=session['user_id'])
    db.session.add(cw)
    db.session.commit()
    return jsonify({'message': '课件上传成功', 'record': ser_cw(cw)}), 201

@app.route('/api/courseware/<uid>', methods=['DELETE'])
@teacher_required
def delete_courseware(uid):
    cw = Courseware.query.filter_by(uid=uid).first()
    if not cw: return jsonify({'error': '未找到'}), 404
    try: os.remove(os.path.join(UPLOAD_FOLDER, cw.filename))
    except OSError: pass
    db.session.delete(cw)
    db.session.commit()
    return jsonify({'message': '已删除'})

# ====== 作业 ======

@app.route('/api/homeworks', methods=['GET'])
@login_required
def get_homeworks():
    subject = request.args.get('subject', '').strip()
    user = User.query.get(session['user_id'])
    q = Homework.query
    if user.role == 'student': q = q.filter_by(student_id=user.id)
    if subject: q = q.filter_by(subject=subject)
    return jsonify({'homeworks': [ser_hw(h) for h in q.order_by(Homework.id.desc()).all()]})

@app.route('/api/homeworks/upload', methods=['POST'])
@login_required
def upload_homework():
    student_name = request.form.get('student_name', session.get('display_name', ''))
    subject = request.form.get('subject', '')
    file = request.files.get('file')
    if not subject: return jsonify({'error': '请选择科目'}), 400
    if not file: return jsonify({'error': '请选择图片'}), 400

    ext = (file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg').lower()
    if ext not in ALLOWED_IMAGE: return jsonify({'error': '仅支持图片格式'}), 400

    file.seek(0, os.SEEK_END)
    if file.tell() > MAX_FILE_SIZE: return jsonify({'error': f'文件不能超过{MAX_FILE_SIZE//1024//1024}MB'}), 400
    file.seek(0)

    safe_name = f"hw_{uuid.uuid4().hex}.{ext}"
    file.save(os.path.join(UPLOAD_FOLDER, safe_name))

    hw = Homework(uid=uuid.uuid4().hex[:8], student_id=session['user_id'],
                  student_name=student_name, subject=subject, filename=safe_name,
                  upload_time=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    db.session.add(hw)
    db.session.commit()
    return jsonify({'message': '提交成功', 'record': ser_hw(hw)}), 201

@app.route('/api/homeworks/<uid>', methods=['PUT'])
@login_required
def review_homework(uid):
    user = User.query.get(session['user_id'])
    if user.role != 'teacher': return jsonify({'error': '仅教师可批改'}), 403
    hw = Homework.query.filter_by(uid=uid).first()
    if not hw: return jsonify({'error': '未找到'}), 404
    data = request.get_json()
    if 'status' in data: hw.status = data['status']
    if 'comment' in data: hw.comment = data['comment']
    hw.reviewed_by = session['user_id']
    db.session.commit()
    return jsonify({'message': '已更新', 'record': ser_hw(hw)})

# ====== 拍照答疑 ======

@app.route('/api/questions', methods=['GET'])
@login_required
def get_questions():
    user = User.query.get(session['user_id'])
    q = Question.query
    if user.role == 'student': q = q.filter_by(student_id=user.id)
    return jsonify({'questions': [ser_qa(r) for r in q.order_by(Question.id.desc()).all()]})

@app.route('/api/questions/ask', methods=['POST'])
@login_required
def ask_question():
    user = User.query.get(session['user_id'])
    subject = request.form.get('subject', '化学')
    question_text = request.form.get('question_text', '').strip()
    file = request.files.get('file')
    if not file: return jsonify({'error': '请上传题目图片'}), 400

    ext = (file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg').lower()
    if ext not in ALLOWED_IMAGE: return jsonify({'error': '仅支持图片'}), 400
    file.seek(0, os.SEEK_END)
    if file.tell() > MAX_FILE_SIZE: return jsonify({'error': f'文件不能超过{MAX_FILE_SIZE//1024//1024}MB'}), 400
    file.seek(0)

    safe_name = f"qa_{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(UPLOAD_FOLDER, safe_name)
    file.save(filepath)

    record_uid = uuid.uuid4().hex[:8]
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Save placeholder record first
    q = Question(uid=record_uid, student_id=session['user_id'],
                 student_name=user.display_name or user.username, subject=subject,
                 filename=safe_name, question_text=question_text,
                 answer='', model_name='',
                 created_at=now)
    db.session.add(q)
    db.session.commit()

    def generate():
        full_answer = ''
        final_model = os.getenv('LLM_MODEL', 'qwen3.7-plus')
        for event in ask_vision_model_stream(filepath, subject, question_text):
            # Parse the SSE event to accumulate answer
            if event.startswith('data: '):
                try:
                    data = json.loads(event[6:])
                    if data.get('t') == 'c':
                        full_answer += data.get('c', '')
                    elif data.get('t') == 'd':
                        final_model = data.get('m', final_model)
                        if data.get('f') and not full_answer:
                            full_answer = data.get('f', '')
                    elif data.get('t') == 'e':
                        full_answer = data.get('c', '')
                        if '未配置大模型' in full_answer:
                            final_model = '未配置'
                except (json.JSONDecodeError, TypeError):
                    pass
            yield event

        # Save full answer to DB
        record = Question.query.filter_by(uid=record_uid).first()
        if record:
            record.answer = full_answer
            record.model_name = final_model
            db.session.commit()

        # Send record info for the frontend to link
        yield f"data: {json.dumps({'t': 'r', 'id': record_uid, 'm': final_model}, ensure_ascii=False)}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/questions/<uid>/followups', methods=['POST'])
@login_required
def ask_followup(uid):
    user = User.query.get(session['user_id'])
    question = Question.query.filter_by(uid=uid).first()
    if not question:
        return jsonify({'error': '未找到这条答疑记录'}), 404
    if user.role == 'student' and question.student_id != user.id:
        return jsonify({'error': '不能追问其他学生的题目'}), 403

    data = request.get_json() or {}
    prompt = data.get('prompt', '').strip()
    if not prompt:
        return jsonify({'error': '请输入追问内容'}), 400

    question_db_id = question.id
    followup_uid = uuid.uuid4().hex[:8]
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    record = QuestionFollowup(
        uid=followup_uid,
        question_id=question.id,
        asked_by=user.id,
        author_name=user.display_name or user.username,
        prompt=prompt,
        answer='',
        model_name='',
        created_at=now
    )
    db.session.add(record)
    db.session.commit()

    def generate():
        full_answer = ''
        final_model = os.getenv('LLM_MODEL', 'qwen3.7-plus')

        def payload_builder():
            fresh_question = Question.query.get(question_db_id)
            previous_followups = (
                QuestionFollowup.query
                .filter(QuestionFollowup.question_id == question_db_id, QuestionFollowup.uid != followup_uid)
                .order_by(QuestionFollowup.id.asc())
                .all()
            )
            return build_followup_payload(fresh_question, previous_followups, prompt)

        for event in stream_payload(payload_builder):
            if event.startswith('data: '):
                try:
                    event_data = json.loads(event[6:])
                    if event_data.get('t') == 'c':
                        full_answer += event_data.get('c', '')
                    elif event_data.get('t') == 'd':
                        final_model = event_data.get('m', final_model)
                        if event_data.get('f') and not full_answer:
                            full_answer = event_data.get('f', '')
                    elif event_data.get('t') == 'e':
                        full_answer = event_data.get('c', '')
                        if '未配置大模型' in full_answer:
                            final_model = '未配置'
                except (json.JSONDecodeError, TypeError):
                    pass
            yield event

        saved = QuestionFollowup.query.filter_by(uid=followup_uid).first()
        if saved:
            saved.answer = full_answer
            saved.model_name = final_model
            db.session.commit()

        yield f"data: {json.dumps({'t': 'r', 'id': followup_uid, 'm': final_model}, ensure_ascii=False)}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5500, debug=False, use_reloader=False)
