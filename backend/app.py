from flask import Flask, request, jsonify, send_from_directory, session, Response, stream_with_context
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
import base64
import json
import mimetypes
import os
import re
import requests
import uuid
from datetime import datetime, timedelta, timezone
from functools import wraps
from io import BytesIO
from sqlalchemy import inspect, or_, text
from zoneinfo import ZoneInfo

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
ALLOWED_SUBJECTS = {'数学', '物理', '化学', '英语'}
MAX_FILE_SIZE = 20 * 1024 * 1024
APP_TIMEZONE = os.getenv('APP_TIMEZONE', 'Asia/Shanghai')

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

class LearningReportCache(db.Model):
    __tablename__ = 'learning_report_caches'
    id = db.Column(db.Integer, primary_key=True)
    cache_key = db.Column(db.String(120), unique=True, nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    days = db.Column(db.Integer, nullable=False)
    target_student_id = db.Column(db.Integer, nullable=True)
    report_json = db.Column(db.Text, nullable=False)
    generated_at = db.Column(db.String(30), nullable=False)

# ====== 初始化 ======

with app.app_context():
    db.create_all()
    cw_columns = {col['name'] for col in inspect(db.engine).get_columns('coursewares')}
    if 'course_date' not in cw_columns:
        db.session.execute(text('ALTER TABLE coursewares ADD COLUMN course_date VARCHAR(20)'))
        db.session.commit()
    for username, pwd, role, display in [
        ('eventually', 'eventually', 'teacher', 'eventually'),
        ('student1', '123456', 'student', '小明'),
    ]:
        if not User.query.filter_by(username=username).first():
            db.session.add(User(username=username, password_hash=bcrypt.generate_password_hash(pwd).decode('utf-8'), role=role, display_name=display))
    db.session.commit()

# ====== 序列化 ======

def app_timezone():
    try:
        return ZoneInfo(APP_TIMEZONE)
    except Exception:
        return ZoneInfo('Asia/Shanghai')

def utc_now_text():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

def local_time_text(value):
    if not value:
        return ''
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.strptime(str(value)[:19], '%Y-%m-%d %H:%M:%S')
        except ValueError:
            return str(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(app_timezone()).strftime('%Y-%m-%d %H:%M:%S')

def local_datetime(value):
    text_value = local_time_text(value)
    if not text_value:
        return None
    try:
        return datetime.strptime(text_value[:19], '%Y-%m-%d %H:%M:%S')
    except ValueError:
        return None

def local_date_text(value):
    dt = local_datetime(value)
    return dt.strftime('%Y-%m-%d') if dt else ''

def date_in_range(day, start_day, end_day):
    if not day:
        return False
    return start_day <= day <= end_day

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
        'created_at': local_time_text(q.created_at),
        'followups': [ser_followup(f) for f in followups]
    }

def ser_followup(f):
    return {
        'id': f.uid,
        'author_name': f.author_name,
        'prompt': f.prompt,
        'answer': f.answer,
        'model_name': f.model_name,
        'created_at': local_time_text(f.created_at)
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

    content = [{'type': 'text', 'text': prompt}]
    if image_path:
        mime_type, encoded = encode_image_for_llm(image_path)
        content.append({'type': 'image_url', 'image_url': {'url': f'data:{mime_type};base64,{encoded}'}})

    high_accuracy = env_flag('LLM_HIGH_ACCURACY', '1')
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': content}],
        'temperature': 0.1 if high_accuracy else 0.2,
        'max_tokens': env_int('LLM_MAX_TOKENS', 2200 if high_accuracy else 1800)
    }
    if env_flag('LLM_ENABLE_THINKING', '1'):
        payload['enable_thinking'] = True
        payload['thinking_budget'] = env_int('LLM_THINKING_BUDGET', 1200 if high_accuracy else 800)
    return base_url, api_key, model, payload

def extract_json_object(text):
    if not text:
        return None
    cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip(), flags=re.IGNORECASE)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r'\{[\s\S]*\}', cleaned)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None

def save_image_with_orientation(path, rotate_clockwise=0):
    if not Image or not ImageOps:
        return False
    rotate_clockwise = int(rotate_clockwise or 0) % 360
    try:
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            if rotate_clockwise:
                img = img.rotate(-rotate_clockwise, expand=True)

            fmt = (img.format or '').upper()
            ext = os.path.splitext(path)[1].lower()
            if ext in {'.jpg', '.jpeg'}:
                fmt = 'JPEG'
            elif ext == '.png':
                fmt = 'PNG'
            elif ext == '.webp':
                fmt = 'WEBP'
            elif ext == '.bmp':
                fmt = 'BMP'
            elif ext == '.gif':
                fmt = 'GIF'
            else:
                fmt = 'JPEG'

            save_kwargs = {}
            if fmt == 'JPEG':
                if img.mode not in ('RGB', 'L'):
                    img = img.convert('RGB')
                save_kwargs.update({'quality': 92, 'optimize': True})
            elif fmt in {'WEBP', 'PNG'} and img.mode == 'P':
                img = img.convert('RGBA')

            img.save(path, format=fmt, **save_kwargs)
            return True
    except Exception as e:
        app.logger.warning('normalize homework image failed: %s', e)
        return False

def detect_homework_orientation(path):
    api_key = os.getenv('LLM_API_KEY')
    base_url = os.getenv('LLM_BASE_URL', '').rstrip('/')
    model = os.getenv('LLM_MODEL', 'qwen3.7-plus')
    if not api_key or not base_url:
        return 0, '未配置大模型'

    prompt = (
        '你只负责判断这张学生作业照片的方向，不要解题。'
        '请观察纸面文字、题号、页眉页脚、横线和书写方向，判断为了让文字变成正向可读，'
        '这张图片还需要顺时针旋转多少度。\n\n'
        '只允许返回严格 JSON，不要解释，不要 Markdown：\n'
        '{"rotate":0,"confidence":"high|medium|low"}\n\n'
        'rotate 只能是 0、90、180、270 之一。拿不准时返回 0，confidence 返回 low。'
    )
    try:
        mime_type, encoded = encode_image_for_llm(path)
        payload = {
            'model': model,
            'messages': [{
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': prompt},
                    {'type': 'image_url', 'image_url': {'url': f'data:{mime_type};base64,{encoded}'}}
                ]
            }],
            'temperature': 0,
            'max_tokens': env_int('LLM_ORIENTATION_MAX_TOKENS', 80),
            'enable_thinking': False
        }
        res = requests.post(
            f'{base_url}/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json=payload,
            timeout=env_int('LLM_ORIENTATION_TIMEOUT', 25)
        )
        if res.status_code >= 400:
            payload.pop('enable_thinking', None)
            res = requests.post(
                f'{base_url}/chat/completions',
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                json=payload,
                timeout=env_int('LLM_ORIENTATION_TIMEOUT', 25)
            )
        res.raise_for_status()
        content = res.json()['choices'][0]['message'].get('content', '')
        data = extract_json_object(content) or {}
        rotate = int(data.get('rotate', 0))
        if rotate not in {0, 90, 180, 270}:
            rotate = 0
        return rotate, data.get('confidence', '')
    except Exception as e:
        app.logger.warning('detect homework orientation failed: %s', e)
        return 0, '识别失败'

def normalize_homework_upload(path):
    save_image_with_orientation(path, 0)
    rotate, confidence = detect_homework_orientation(path)
    if rotate:
        save_image_with_orientation(path, rotate)
    return {'rotate': rotate, 'confidence': confidence}

def build_vision_payload(image_path, subject, question_text):
    input_mode = '题目图片 + 文字补充' if image_path else '纯文字问题'
    prompt = (
        '你是一位高效、准确的高中学习导师，擅长数学、物理、化学和英语。'
        '请严格按学生选择的科目解答；如果题目内容和所选科目明显不一致，要先指出并按题目实际内容谨慎说明。\n'
        '请根据学生提供的图片或文字问题解答，要求：\n'
        '1. 如果有图片，先识别题目图片；如果没有图片，就直接根据文字问题回答。不要要求学生必须上传图片。\n'
        '2. 不要长篇复述题干，只提取解题必须信息；图片不清楚或文字条件不足时直接指出需要补充什么。\n'
        '3. 必须展示给学生看的推理过程：条件提取、公式/原理/语法点选择、关键判断、必要计算或翻译依据。\n'
        '4. 选择题只分析关键选项；计算题保留关键公式和代入过程。\n'
        '5. 数理化公式、化学式、离子、电荷、分数、反应箭头要用规范可读写法；英语题要讲清词汇、语法、句子结构和答案依据。\n\n'
        '遇到复杂晶胞或有机推断题，要先自查关键风险点：晶胞粒子数/配位数/密度公式，'
        '有机题的不饱和度/官能团/反应类型/同分异构，不能确定时明确说明不确定原因。\n\n'
        '请用以下结构回答：\n'
        '## 识别\n一句话概括题型和已知条件。\n\n'
        '## 推理过程\n3-6步讲清条件怎么用、为什么选这个方法、怎么算到答案。\n\n'
        '## 答案\n给出最终答案。\n\n'
        '## 易错点\n最多2条。'
        f'\n\n输入方式：{input_mode}\n科目：{subject}\n孩子的问题：{question_text or "请完整讲解"}'
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
        '你是一位耐心的高中学习导师，擅长数学、物理、化学和英语。学生正在针对同一道题继续追问。'
        '请结合题目图片、前面的讲解和追问上下文回答，不要重新识别整道题，'
        '只回答这次追问。回答要短、准、分步骤，并展示给学生看的关键推理过程，公式显示尽量简洁。\n\n'
        + '\n\n'.join(previous)
        + f'\n\n本次追问：{prompt}\n\n'
        '请按以下结构回答：\n'
        '## 追问回答\n直接回答这次问题。\n\n'
        '## 推理过程\n解释关键原因、条件怎么用、必要推理或计算。\n\n'
        '## 小提醒\n一句话指出容易混淆点。'
    )
    image_path = os.path.join(UPLOAD_FOLDER, question.filename) if question.filename else None
    return build_payload_from_prompt(image_path, full_prompt)

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

# ====== 学习报告 ======

REPORT_TOPICS = [
    ('晶胞计算', ['晶胞', '配位数', '密度', '坐标', 'Ni', '晶格', '空间利用率']),
    ('有机推断', ['有机', '同分异构', '官能团', '加成', '取代', '消去', '氧化', '酯化']),
    ('氧化还原', ['氧化剂', '还原剂', '氧化还原', '化合价', '电子转移']),
    ('电离与水解', ['电离', '水解', '弱酸', '弱碱', 'Ka', 'Kb', 'pH']),
    ('化学平衡', ['平衡', 'Ksp', '勒夏特列', '转化率', '速率']),
    ('结构与杂化', ['杂化', 'VSEPR', '空间结构', '价层电子对', 'sp', '等电子体']),
    ('离子方程式', ['离子方程式', '离子反应', '沉淀', '电荷守恒']),
    ('实验分析', ['实验', '装置', '现象', '检验', '除杂', '滴定']),
    ('计算与守恒', ['计算', '物质的量', '守恒', '浓度', '质量分数', '阿伏伽德罗'])
]

def report_topic_scores(text):
    source = (text or '').lower()
    scores = []
    for name, words in REPORT_TOPICS:
        score = sum(source.count(word.lower()) for word in words)
        if score:
            scores.append({'name': name, 'score': score})
    return scores

def report_level(value, good, ok):
    if value >= good:
        return '稳步推进'
    if value >= ok:
        return '需要保持'
    return '需要加强'

def report_cache_key(user, days, student_id):
    target = student_id or 'all'
    return f'user:{user.id}:role:{user.role}:days:{days}:student:{target}'

def cached_report_response(user, days, student_id):
    cache = LearningReportCache.query.filter_by(cache_key=report_cache_key(user, days, student_id)).first()
    if not cache:
        return None
    try:
        data = json.loads(cache.report_json)
    except json.JSONDecodeError:
        return None
    data['from_cache'] = True
    data['cache_generated_at'] = local_time_text(cache.generated_at)
    return data

def save_report_cache(user, days, student_id, report_data):
    key = report_cache_key(user, days, student_id)
    cache = LearningReportCache.query.filter_by(cache_key=key).first()
    if not cache:
        cache = LearningReportCache(cache_key=key, owner_id=user.id, days=days, target_student_id=student_id)
        db.session.add(cache)
    cache.report_json = json.dumps(report_data, ensure_ascii=False)
    cache.generated_at = utc_now_text()
    db.session.commit()

def generate_ai_learning_report(report_data, questions, homeworks, coursewares):
    base_url, api_key, model, payload_or_error = build_payload_from_prompt(None, '')
    if base_url is None:
        return '', '未配置', payload_or_error

    question_briefs = []
    for q in questions[:12]:
        question_briefs.append({
            'time': local_time_text(q.created_at),
            'student': q.student_name,
            'subject': q.subject,
            'question': (q.question_text or '图片答疑')[:260],
            'answer_excerpt': (q.answer or '')[:600]
        })

    homework_briefs = []
    for h in homeworks[:12]:
        homework_briefs.append({
            'time': local_time_text(h.upload_time),
            'student': h.student_name,
            'subject': h.subject,
            'status': h.status,
            'teacher_comment': (h.comment or '')[:240]
        })

    courseware_briefs = [
        {'date': c.course_date or local_date_text(c.upload_time), 'title': c.title}
        for c in coursewares[:10]
    ]

    packed_data = {
        'range': report_data['range'],
        'student': report_data['student'],
        'summary': report_data['summary'],
        'homework_status': report_data['homework_status'],
        'weak_topics_by_rules': report_data['weak_topics'],
        'weak_items_by_rules': report_data['weak_items'],
        'courseware': courseware_briefs,
        'questions': question_briefs,
        'homeworks': homework_briefs
    }

    prompt = (
        '你是一位高中化学家教老师，正在给家长和老师生成学生学习报告。'
        '请只根据下面 JSON 数据分析，不要编造不存在的作业、错题或分数。'
        '如果数据不足，要明确说“数据不足”，并给出接下来应该补充哪些记录。\n\n'
        '报告要求：\n'
        '1. 用中文，语气客观、可执行，不要营销口吻。\n'
        '2. 必须分析学习进度、错题/薄弱点、答疑追问质量、作业完成情况。\n'
        '3. 化学薄弱点要尽量具体到题型或知识点，例如氧化还原、晶胞计算、有机推断、杂化/VSEPR等。\n'
        '4. 给出下一阶段3-5条具体行动建议，每条要能执行。\n'
        '5. 不要输出内部思考过程，不要说你是AI。\n\n'
        '请按这个结构输出 Markdown：\n'
        '## 总体判断\n'
        '2-3句话说明这一周期学习状态。\n\n'
        '## 学习进度\n'
        '结合课件、作业、答疑、追问数量分析推进情况。\n\n'
        '## 错题与薄弱点\n'
        '列出主要薄弱主题，并解释为什么判断为薄弱点。\n\n'
        '## 作业反馈\n'
        '分析作业状态、待修改情况和老师评语。\n\n'
        '## 下一步安排\n'
        '用编号列出3-5条具体建议。\n\n'
        f'学习数据 JSON：\n{json.dumps(packed_data, ensure_ascii=False)}'
    )

    payload = dict(payload_or_error)
    payload['messages'] = [{'role': 'user', 'content': [{'type': 'text', 'text': prompt}]}]
    payload['temperature'] = 0.2
    payload['max_tokens'] = env_int('LLM_REPORT_MAX_TOKENS', 1800)
    if env_flag('LLM_ENABLE_THINKING', '1'):
        payload['enable_thinking'] = True
        payload['thinking_budget'] = env_int('LLM_REPORT_THINKING_BUDGET', 700)

    try:
        res = requests.post(
            f'{base_url}/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json=payload,
            timeout=env_int('LLM_REPORT_TIMEOUT', 90)
        )
        if res.status_code >= 400 and ('enable_thinking' in payload or 'thinking_budget' in payload):
            fallback = dict(payload)
            fallback.pop('enable_thinking', None)
            fallback.pop('thinking_budget', None)
            res = requests.post(
                f'{base_url}/chat/completions',
                headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
                json=fallback,
                timeout=env_int('LLM_REPORT_TIMEOUT', 90)
            )
        res.raise_for_status()
        return res.json()['choices'][0]['message'].get('content', '').strip(), model, ''
    except Exception as e:
        app.logger.warning('generate ai learning report failed: %s', e)
        return '', model, f'AI报告生成失败：{str(e)}'

@app.route('/api/report', methods=['GET'])
@login_required
def learning_report():
    user = User.query.get(session['user_id'])
    days = 7
    try:
        days = int(request.args.get('days', days))
    except (TypeError, ValueError):
        days = 7
    if days not in {3, 7, 14, 30}:
        days = 7

    local_today = datetime.now(timezone.utc).astimezone(app_timezone()).date()
    start_day = (local_today - timedelta(days=days - 1)).strftime('%Y-%m-%d')
    end_day = local_today.strftime('%Y-%m-%d')

    student_id = request.args.get('student_id', '').strip()
    target_user = user
    if user.role == 'teacher' and student_id:
        found = User.query.get(int(student_id)) if student_id.isdigit() else None
        if found:
            target_user = found

    student_filter_id = target_user.id if target_user.role == 'student' else None
    refresh = env_flag('REPORT_FORCE_REFRESH', '0') or request.args.get('refresh', '').strip().lower() in {'1', 'true', 'yes'}
    if not refresh:
        cached = cached_report_response(user, days, student_filter_id)
        if cached:
            return jsonify(cached)

    hw_query = Homework.query
    q_query = Question.query
    if student_filter_id:
        hw_query = hw_query.filter_by(student_id=student_filter_id)
        q_query = q_query.filter_by(student_id=student_filter_id)

    homeworks = []
    for item in hw_query.order_by(Homework.id.desc()).all():
        day = local_date_text(item.upload_time)
        if date_in_range(day, start_day, end_day):
            homeworks.append(item)

    questions = []
    for item in q_query.order_by(Question.id.desc()).all():
        day = local_date_text(item.created_at)
        if date_in_range(day, start_day, end_day):
            questions.append(item)

    question_ids = [q.id for q in questions]
    followups = []
    if question_ids:
        for item in QuestionFollowup.query.filter(QuestionFollowup.question_id.in_(question_ids)).all():
            day = local_date_text(item.created_at)
            if date_in_range(day, start_day, end_day):
                followups.append(item)

    coursewares = []
    for item in Courseware.query.filter_by(subject='化学').order_by(Courseware.id.desc()).all():
        day = item.course_date or local_date_text(item.upload_time)
        if date_in_range(day, start_day, end_day):
            coursewares.append(item)

    active_days = sorted({
        local_date_text(h.upload_time) for h in homeworks
    } | {
        local_date_text(q.created_at) for q in questions
    } | {
        item.course_date or local_date_text(item.upload_time) for item in coursewares
    })
    active_days = [d for d in active_days if d]

    status_counts = {}
    for item in homeworks:
        status_counts[item.status] = status_counts.get(item.status, 0) + 1

    topic_count = {}
    weak_items = []
    for q in questions:
        combined = '\n'.join([q.question_text or '', q.answer or ''])
        for item in report_topic_scores(combined):
            topic_count[item['name']] = topic_count.get(item['name'], 0) + item['score']
        risk_text = (q.answer or '')[:240]
        if any(key in (q.answer or '') for key in ['易错', '错误', '不确定', '信息不足', '需要补充']):
            weak_items.append({
                'type': '答疑错题',
                'title': q.question_text or '图片答疑',
                'time': local_time_text(q.created_at),
                'note': risk_text
            })

    for h in homeworks:
        if h.status in {'待修改', '批改中'} or h.comment:
            weak_items.append({
                'type': '作业反馈',
                'title': f'{h.subject}作业 · {h.status}',
                'time': local_time_text(h.upload_time),
                'note': h.comment or '老师还未给出详细评语，建议回看这份作业。'
            })

    top_topics = sorted(topic_count.items(), key=lambda x: x[1], reverse=True)[:5]
    weak_topics = [{'name': name, 'count': count} for name, count in top_topics]

    qa_count = len(questions)
    homework_count = len(homeworks)
    courseware_count = len(coursewares)
    followup_count = len(followups)
    revision_count = status_counts.get('待修改', 0)
    reviewed_count = status_counts.get('已批改', 0) + status_counts.get('已完成', 0)

    progress_score = min(100, qa_count * 12 + homework_count * 18 + courseware_count * 10 + len(active_days) * 8 + followup_count * 5)
    if revision_count:
        progress_score = max(0, progress_score - revision_count * 10)

    suggestions = []
    if weak_topics:
        suggestions.append(f'优先复盘 {weak_topics[0]["name"]}，把同类题整理成错题卡。')
    if revision_count:
        suggestions.append('先处理待修改作业，要求学生写出订正原因，而不是只改答案。')
    if qa_count == 0:
        suggestions.append('本周期没有答疑记录，建议每天至少整理1个卡点问题。')
    if homework_count == 0:
        suggestions.append('本周期没有打卡作业，建议固定课后拍照上传，形成连续监督。')
    if followup_count < qa_count and qa_count:
        suggestions.append('部分题目没有继续追问，建议对不懂的步骤追问到能复述为止。')
    if not suggestions:
        suggestions.append('当前节奏稳定，继续保持课件学习、作业打卡和错题追问闭环。')

    students = []
    if user.role == 'teacher':
        students = [
            {'id': s.id, 'name': s.display_name or s.username}
            for s in User.query.filter_by(role='student').order_by(User.id.asc()).all()
        ]

    report_student = {'id': target_user.id, 'name': target_user.display_name or target_user.username, 'role': target_user.role}
    if user.role == 'teacher' and not student_id:
        report_student = {'id': '', 'name': '全部学生', 'role': 'teacher'}

    report_data = {
        'range': {'days': days, 'start': start_day, 'end': end_day},
        'student': report_student,
        'students': students,
        'summary': {
            'progress_score': progress_score,
            'progress_level': report_level(progress_score, 75, 45),
            'active_days': len(active_days),
            'courseware_count': courseware_count,
            'homework_count': homework_count,
            'reviewed_count': reviewed_count,
            'revision_count': revision_count,
            'qa_count': qa_count,
            'followup_count': followup_count
        },
        'homework_status': status_counts,
        'weak_topics': weak_topics,
        'weak_items': weak_items[:8],
        'recent_courseware': [
            {'title': c.title, 'date': c.course_date or local_date_text(c.upload_time), 'filename': c.filename}
            for c in coursewares[:6]
        ],
        'suggestions': suggestions
    }
    ai_report, report_model, report_error = generate_ai_learning_report(report_data, questions, homeworks, coursewares)
    report_data['ai_report'] = ai_report
    report_data['report_model'] = report_model
    report_data['report_error'] = report_error
    report_data['from_cache'] = False
    report_data['cache_generated_at'] = ''
    save_report_cache(user, days, student_filter_id, report_data)
    return jsonify(report_data)

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
    if subject and subject not in ALLOWED_SUBJECTS:
        return jsonify({'error': '科目仅支持数学、物理、化学、英语'}), 400
    q = Homework.query
    if user.role == 'student': q = q.filter_by(student_id=user.id)
    if subject: q = q.filter_by(subject=subject)
    return jsonify({'homeworks': [ser_hw(h) for h in q.order_by(Homework.id.desc()).all()]})

@app.route('/api/homeworks/upload', methods=['POST'])
@login_required
def upload_homework():
    student_name = request.form.get('student_name', session.get('display_name', ''))
    subject = request.form.get('subject', '').strip()
    file = request.files.get('file')
    if not subject: return jsonify({'error': '请选择科目'}), 400
    if subject not in ALLOWED_SUBJECTS:
        return jsonify({'error': '科目仅支持数学、物理、化学、英语'}), 400
    if not file: return jsonify({'error': '请选择图片'}), 400

    ext = (file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg').lower()
    if ext not in ALLOWED_IMAGE: return jsonify({'error': '仅支持图片格式'}), 400

    file.seek(0, os.SEEK_END)
    if file.tell() > MAX_FILE_SIZE: return jsonify({'error': f'文件不能超过{MAX_FILE_SIZE//1024//1024}MB'}), 400
    file.seek(0)

    safe_name = f"hw_{uuid.uuid4().hex}.{ext}"
    saved_path = os.path.join(UPLOAD_FOLDER, safe_name)
    file.save(saved_path)
    orientation = normalize_homework_upload(saved_path)

    hw = Homework(uid=uuid.uuid4().hex[:8], student_id=session['user_id'],
                  student_name=student_name, subject=subject, filename=safe_name,
                  upload_time=datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    db.session.add(hw)
    db.session.commit()
    return jsonify({'message': '提交成功', 'record': ser_hw(hw), 'orientation': orientation}), 201

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

@app.route('/api/homeworks/<uid>', methods=['DELETE'])
@login_required
def delete_homework(uid):
    user = User.query.get(session['user_id'])
    hw = Homework.query.filter_by(uid=uid).first()
    if not hw:
        return jsonify({'error': '未找到'}), 404
    if user.role != 'teacher' and hw.student_id != user.id:
        return jsonify({'error': '只能删除自己的作业'}), 403

    filepath = os.path.join(UPLOAD_FOLDER, hw.filename)
    db.session.delete(hw)
    db.session.commit()
    try:
        if os.path.exists(filepath):
            os.remove(filepath)
    except OSError as e:
        app.logger.warning('delete homework file failed: %s', e)
    return jsonify({'message': '已删除打卡作业'})

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
    subject = request.form.get('subject', '化学').strip()
    question_text = request.form.get('question_text', '').strip()
    file = request.files.get('file')
    if subject not in ALLOWED_SUBJECTS:
        return jsonify({'error': '科目仅支持数学、物理、化学、英语'}), 400
    if not file and not question_text:
        return jsonify({'error': '请上传题目图片，或输入需要答疑的问题'}), 400

    safe_name = ''
    filepath = None
    if file:
        ext = (file.filename.rsplit('.', 1)[-1] if '.' in file.filename else 'jpg').lower()
        if ext not in ALLOWED_IMAGE: return jsonify({'error': '仅支持图片'}), 400
        file.seek(0, os.SEEK_END)
        if file.tell() > MAX_FILE_SIZE: return jsonify({'error': f'文件不能超过{MAX_FILE_SIZE//1024//1024}MB'}), 400
        file.seek(0)

        safe_name = f"qa_{uuid.uuid4().hex}.{ext}"
        filepath = os.path.join(UPLOAD_FOLDER, safe_name)
        file.save(filepath)

    record_uid = uuid.uuid4().hex[:8]
    now = utc_now_text()

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
    now = utc_now_text()

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
