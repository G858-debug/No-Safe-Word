"""
Stream bodylicious-flux.safetensors from RunPod S3 directly to HuggingFace
without saving to disk (uses in-memory buffer via io.BytesIO).
"""
import os, sys, hashlib, hmac, io
from datetime import datetime, timezone
from pathlib import Path

# Load .env.local
env_path = Path(__file__).parent.parent / '.env.local'
for line in env_path.read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        k, v = k.strip(), v.strip()
        if k and k not in os.environ:
            os.environ[k] = v

from huggingface_hub import HfApi, create_repo
import urllib.request

S3_ACCESS_KEY = os.environ['RUNPOD_S3_ACCESS_KEY']
S3_SECRET_KEY = os.environ['RUNPOD_S3_SECRET_KEY']
S3_ENDPOINT = os.environ['RUNPOD_S3_ENDPOINT'].rstrip('/')
S3_REGION = os.environ.get('RUNPOD_S3_REGION', 'eu-ro-1')
BUCKET = os.environ['RUNPOD_NETWORK_VOLUME_ID']
HF_TOKEN = os.environ['HUGGINGFACE_TOKEN']
S3_HOST = urllib.request.urlparse(S3_ENDPOINT).hostname

LORA_KEY = 'models/loras/bodylicious-flux.safetensors'
HF_REPO = 'nosafe/bodylicious-flux'

def sha256(data):
    return hashlib.sha256(data).hexdigest()

def hmac_sha256(key, data):
    return hmac.new(key, data.encode('utf-8') if isinstance(data, str) else data, hashlib.sha256).digest()

def get_signing_key(secret, date_stamp, region, service):
    k = hmac_sha256(('AWS4' + secret).encode(), date_stamp)
    k = hmac_sha256(k, region)
    k = hmac_sha256(k, service)
    return hmac_sha256(k, 'aws4_request')

def build_signed_url():
    now = datetime.now(timezone.utc)
    date = now.strftime('%Y%m%dT%H%M%SZ')
    date_stamp = now.strftime('%Y%m%d')
    path = f'/{BUCKET}/{LORA_KEY}'
    payload_hash = 'UNSIGNED-PAYLOAD'
    
    headers = {'host': S3_HOST, 'x-amz-date': date, 'x-amz-content-sha256': payload_hash}
    signed_headers = ';'.join(sorted(headers.keys()))
    canonical_headers = ''.join(f'{k}:{v}\n' for k, v in sorted(headers.items()))
    
    canonical_request = f'GET\n{path}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}'
    credential_scope = f'{date_stamp}/{S3_REGION}/s3/aws4_request'
    string_to_sign = f'AWS4-HMAC-SHA256\n{date}\n{credential_scope}\n{sha256(canonical_request.encode())}'
    
    signing_key = get_signing_key(S3_SECRET_KEY, date_stamp, S3_REGION, 's3')
    signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    
    auth = f'AWS4-HMAC-SHA256 Credential={S3_ACCESS_KEY}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}'
    
    return f'{S3_ENDPOINT}{path}', {
        'Host': S3_HOST,
        'x-amz-date': date,
        'x-amz-content-sha256': payload_hash,
        'Authorization': auth,
    }

def main():
    # Step 1: Download from RunPod S3 into memory
    print(f'Downloading {LORA_KEY} from RunPod S3...')
    url, headers = build_signed_url()
    
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = resp.read()
    
    size_mb = len(data) / 1024 / 1024
    print(f'Downloaded: {size_mb:.0f}MB')
    
    # Step 2: Upload to HuggingFace
    print(f'\nCreating HF repo: {HF_REPO}...')
    api = HfApi(token=HF_TOKEN)
    
    try:
        create_repo(HF_REPO, repo_type='model', private=False, token=HF_TOKEN)
        print('Repo created')
    except Exception as e:
        if '409' in str(e) or 'already' in str(e).lower():
            print('Repo already exists')
        else:
            print(f'Note: {e}')
    
    print(f'Uploading {size_mb:.0f}MB to HuggingFace...')
    buf = io.BytesIO(data)
    api.upload_file(
        path_or_fileobj=buf,
        path_in_repo='bodylicious-flux.safetensors',
        repo_id=HF_REPO,
        repo_type='model',
    )
    
    hf_url = f'https://huggingface.co/{HF_REPO}/resolve/main/bodylicious-flux.safetensors'
    print(f'\nDone! URL:\n{hf_url}')

if __name__ == '__main__':
    main()
