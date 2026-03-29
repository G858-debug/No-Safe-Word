# Kohya LoRA Training Image for Pony V6 / CyberRealistic SDXL
#
# Runs sdxl_train_network.py with Prodigy optimizer.
# Receives config via env vars, downloads dataset + checkpoint,
# trains LoRA, uploads result, POSTs webhook.

FROM runpod/pytorch:2.4.1-py3.11-cuda12.4.1-devel-ubuntu22.04

WORKDIR /app

# Clone Kohya sd-scripts at a known-good commit
RUN git clone https://github.com/kohya-ss/sd-scripts.git /app/sd-scripts && \
    cd /app/sd-scripts && \
    git checkout sd3 && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -e .

# Training-specific dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy entrypoint
COPY train_entrypoint.py /app/train_entrypoint.py

ENTRYPOINT ["python3", "/app/train_entrypoint.py"]
