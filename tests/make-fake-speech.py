"""e2e용 가짜 '말소리' WAV 생성: 음절 같은 유성음 구간 + 짧은 틈 + 가끔 1.2초 멈춤 (VAD/멈춤 통계 확인용)."""
import numpy as np, wave, sys
sr = 48000
rng = np.random.default_rng(7)
out = []
t_total = 0.0
while t_total < 30:
    # 한 '구' = 음절 4~8개
    for _ in range(rng.integers(4, 9)):
        d = rng.uniform(0.12, 0.28)
        t = np.arange(int(sr * d)) / sr
        f0 = rng.uniform(110, 170)
        sig = sum(np.sin(2 * np.pi * f0 * k * t) / k for k in range(1, 6))
        env = np.sin(np.pi * t / d) ** 0.6
        out.append(0.25 * sig * env)
        out.append(np.zeros(int(sr * rng.uniform(0.03, 0.09))))
        t_total += d + 0.06
    gap = 1.3 if rng.random() < 0.35 else rng.uniform(0.25, 0.5)
    out.append(np.zeros(int(sr * gap))); t_total += gap
x = np.concatenate(out)
x += rng.normal(0, 0.002, x.size)
x = np.clip(x, -1, 1)
path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/fake-speech.wav'
with wave.open(path, 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((x * 32767).astype('<i2').tobytes())
print(path, round(x.size / sr, 1), 's')
