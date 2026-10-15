"""Small real FP16 forward/backward probe before downloading/training BERT."""
import json
import sys


def main():
    import torch
    if not torch.cuda.is_available():
        raise SystemExit('GPU не найдена. Нужны драйвер AMD и сборка PyTorch ROCm для Python 3.12; CPU/CUDA-сборка для Radeon не подходит.')
    name = torch.cuda.get_device_name(0)
    if ('radeon' in name.lower() or '9070' in name) and not torch.version.hip:
        raise SystemExit('Для Radeon требуется PyTorch с ROCm/HIP.')
    device = torch.device('cuda')
    model = torch.nn.Sequential(torch.nn.Linear(128,128),torch.nn.LayerNorm(128),torch.nn.Linear(128,3)).to(device)
    optimizer = torch.optim.AdamW(model.parameters(),lr=1e-4)
    scaler = torch.amp.GradScaler('cuda')
    inputs = torch.randn(4,32,128,device=device)
    labels = torch.randint(0,3,(4,32),device=device)
    with torch.autocast('cuda',dtype=torch.float16):
        logits = model(inputs)
        loss = torch.nn.functional.cross_entropy(logits.reshape(-1,3),labels.reshape(-1))
    scaler.scale(loss).backward()
    scaler.step(optimizer)
    scaler.update()
    torch.cuda.synchronize()
    if not torch.isfinite(loss):
        raise SystemExit('GPU FP16 probe produced non-finite loss.')
    print(json.dumps({'gpu':name,'torch':torch.__version__,'hip':torch.version.hip,'cuda_runtime':torch.version.cuda,
                      'vram_gb':round(torch.cuda.get_device_properties(0).total_memory/2**30,2),
                      'fp16_backward':'PASS','loss':float(loss.detach())},ensure_ascii=False))


if __name__=='__main__':
    main()
