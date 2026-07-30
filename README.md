# Tutor Homework

一个面向家长、老师和学生的高中化学学习监督与拍照答疑网页应用。

## 功能

- 学生注册和登录
- 课程资料上传、查看和删除
- 学生作业拍照上传
- 老师批改作业并留下评语
- AI 拍照搜题和流式答疑
- 每道题支持继续追问
- 支持化学式、上下标、分式和常见 LaTeX/MathJax 渲染

## Docker 一键启动

先复制环境变量模板：

```bash
cp .env.example .env
```

然后编辑 `.env`，填入你的通义千问 DashScope API Key：

```env
LLM_API_KEY=your_dashscope_api_key
```

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://127.0.0.1:5500/
```

## 默认账号

```text
老师：admin账号 teacher / admin123
学生：student1 / 123456
```

## 本地开发

```bash
pip install -r requirements.txt
python backend/app.py
```

## 数据和上传文件

运行时数据不会提交到 Git：

- SQLite 数据库：`data/tutor.db`
- 上传文件：`uploads/`
- 临时文件：`tmp/`
- 输出文件：`output/`

这些目录由 Docker Compose 挂载到容器中，用来保留本机运行数据。
