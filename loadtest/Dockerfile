FROM python:3.12-slim

WORKDIR /app

COPY loadtest/requirements.txt /tmp/loadtest-requirements.txt
RUN pip install --no-cache-dir -r /tmp/loadtest-requirements.txt

COPY backend/scripts/load_test.py /app/load_test.py

CMD ["python", "/app/load_test.py"]
