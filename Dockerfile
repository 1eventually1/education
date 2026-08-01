FROM docker.m.daocloud.io/library/python:3.13-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN mkdir -p uploads output tmp

EXPOSE 5500

CMD ["python", "backend/app.py"]
