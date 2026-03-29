# Kohya LoRA Training Image for Pony V6 / CyberRealistic SDXL
#
# Runs sdxl_train_network.py with Prodigy optimizer.
# Receives config via env vars, downloads dataset + checkpoint,
# trains LoRA, uploads result, POSTs webhook.

FROM nvidia/cuda:12.4.1-devel-ubuntu22.04

# Prevent interactive prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3.11-dev python3-pip \
    git wget curl \
    libgl1-mesa-glx libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1

# Install PyTorch (CUDA 12.4)
RUN pip install --no-cache-dir \
    torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124

# Install xformers for memory-efficient attention
RUN pip install --no-cache-dir xformers==0.0.28.post3 --index-url https://download.pytorch.org/whl/cu124

# Clone Kohya sd-scripts at a stable tag
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
