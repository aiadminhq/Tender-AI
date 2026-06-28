import time, sys
from datetime import datetime
from app.adapters.pcc import PCCAdapter
from app.services.detail_parser import is_captcha_page
a = PCCAdapter()
pk = '71219523'
start = time.time()
for i in range(20):
    fr = a.fetch_detail(pk)
    cap = is_captcha_page(fr.raw_content)
    el = int(time.time() - start)
    print(f'[{datetime.now():%H:%M:%S}] +{el:4d}s  bytes={len(fr.raw_content):6d}  captcha={cap}', flush=True)
    if not cap:
        print(f'>>> CLEARED after ~{el}s (純時間冷卻自動解除，未解題)', flush=True)
        break
    time.sleep(60)
else:
    print('>>> still blocked after 20 min', flush=True)
