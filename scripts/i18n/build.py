# Builds ui/i18n/<lang>.json from scripts/i18n/catalog.json (source strings, Simplified Chinese)
# and scripts/i18n/src/*.tsv (id \t en \t zh-TW \t ja \t ko; "-" = not translated, "⏎" = newline).
# Usage: python3 scripts/i18n/build.py
import json, re, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
LANGS = ['en', 'zh-TW', 'ja', 'ko']
NAMES = {'en': 'English', 'zh-TW': '繁體中文', 'ja': '日本語', 'ko': '한국어'}
catalog = json.loads((HERE / 'catalog.json').read_text(encoding='utf8'))
rows = {}
for f in sorted((HERE / 'src').glob('*.tsv')):
    for n, line in enumerate(f.read_text(encoding='utf8').split('\n'), 1):
        if not line.strip(): continue
        cols = line.split('\t')
        if len(cols) != 5: sys.exit(f'{f.name}:{n}: expected 5 columns, got {len(cols)}')
        rows[int(cols[0])] = cols[1:]
missing = [i for i in range(len(catalog)) if i not in rows]
if missing: sys.exit(f'missing ids: {missing[:20]} ({len(missing)})')

# Dynamic strings: [regex on the Chinese text, {lang: replacement with $1…}]. Captures are translated too.
PATTERNS = [
    (r'^(.+) 快捷键$', {'en': '$1 shortcut', 'zh-TW': '$1 快速鍵', 'ja': '$1 のショートカット', 'ko': '$1 단축키'}),
    (r'^([\d,]+) 字 · 约 (\d+) 分钟读完$', {'en': '$1 words · about $2 min read', 'zh-TW': '$1 字 · 約 $2 分鐘讀完', 'ja': '$1 文字 · 約 $2 分で読了', 'ko': '$1자 · 약 $2분 소요'}),
    (r'^([\d,]+) 字 · 行 (\d+), 列 (\d+)$', {'en': '$1 words · Ln $2, Col $3', 'zh-TW': '$1 字 · 第 $2 行，第 $3 欄', 'ja': '$1 文字 · $2 行, $3 列', 'ko': '$1자 · $2행, $3열'}),
    (r'^([\d,]+) 字 · 共 ([\d,]+) 行 · 点击查看字数统计$', {'en': '$1 words · $2 lines · click for word count', 'zh-TW': '$1 字 · 共 $2 行 · 點擊檢視字數統計', 'ja': '$1 文字 · 全 $2 行 · クリックで文字数を表示', 'ko': '$1자 · 총 $2줄 · 클릭하여 단어 수 보기'}),
    (r'^上次关闭时的 (\d+) 个标签$', {'en': '$1 tabs from last time', 'zh-TW': '上次關閉時的 $1 個分頁', 'ja': '前回終了時の $1 個のタブ', 'ko': '지난번 탭 $1개'}),
    (r'^重新打开上次关闭时的 (\d+) 个标签$', {'en': 'Reopen the $1 tabs from last time', 'zh-TW': '重新開啟上次關閉時的 $1 個分頁', 'ja': '前回終了時の $1 個のタブを開き直す', 'ko': '지난번 탭 $1개 다시 열기'}),
    (r'^当前默认：(.+)$', {'en': 'Current default: $1', 'zh-TW': '目前預設：$1', 'ja': '現在の既定：$1', 'ko': '현재 기본값: $1'}),
    (r'^注册的程序位置：(.+)。移动 exe 后需要重新注册。$', {'en': 'Registered program: $1. Register again after moving the exe.', 'zh-TW': '註冊的程式位置：$1。移動 exe 後需要重新註冊。', 'ja': '登録したプログラム：$1。exe を移動したら再登録してください。', 'ko': '등록된 프로그램 위치: $1. exe를 옮기면 다시 등록해야 합니다.'}),
    (r'^版本 (.+)$', {'en': 'Version $1', 'zh-TW': '版本 $1', 'ja': 'バージョン $1', 'ko': '버전 $1'}),
    (r'^已打开 (.+)$', {'en': 'Opened $1', 'zh-TW': '已開啟 $1', 'ja': '$1 を開きました', 'ko': '$1 열림'}),
    (r'^已保存到 (.+)$', {'en': 'Saved to $1', 'zh-TW': '已儲存到 $1', 'ja': '$1 に保存しました', 'ko': '$1에 저장했습니다'}),
    (r'^已导出到 (.+)$', {'en': 'Exported to $1', 'zh-TW': '已匯出到 $1', 'ja': '$1 に書き出しました', 'ko': '$1(으)로 내보냈습니다'}),
    (r'^青页 PDF (\S+) · 本地开源工具箱 · 无登录、无订阅、无广告$', {'en': 'Qingye PDF $1 · local open-source toolbox · no login, no subscription, no ads', 'zh-TW': '青頁 PDF $1 · 本機開源工具箱 · 無登入、無訂閱、無廣告', 'ja': '青頁 PDF $1 · ローカルのオープンソースツール · ログイン・サブスク・広告なし', 'ko': '칭예 PDF $1 · 로컬 오픈 소스 도구 · 로그인·구독·광고 없음'}),
    (r'^读到第 (\d+) 页$', {'en': 'Read to page $1', 'zh-TW': '讀到第 $1 頁', 'ja': '$1 ページまで読了', 'ko': '$1페이지까지 읽음'}),
    (r'^今天 (\d+:\d+)$', {'en': 'Today $1', 'zh-TW': '今天 $1', 'ja': '今日 $1', 'ko': '오늘 $1'}),
    (r'^昨天 (\d+:\d+)$', {'en': 'Yesterday $1', 'zh-TW': '昨天 $1', 'ja': '昨日 $1', 'ko': '어제 $1'}),
    (r'^(\d+) 天前$', {'en': '$1 days ago', 'zh-TW': '$1 天前', 'ja': '$1 日前', 'ko': '$1일 전'}),
    (r'^(\d+) 月 (\d+) 日$', {'en': '$1/$2', 'zh-TW': '$1 月 $2 日', 'ja': '$1 月 $2 日', 'ko': '$1월 $2일'}),
    (r'^显示全部 (\d+) 个$', {'en': 'Show all $1', 'zh-TW': '顯示全部 $1 個', 'ja': 'すべて表示（$1 件）', 'ko': '전체 $1개 보기'}),
    (r'^从最近列表中移除 (.+)$', {'en': 'Remove $1 from the recent list', 'zh-TW': '從最近清單中移除 $1', 'ja': '$1 を最近の一覧から削除', 'ko': '최근 목록에서 $1 제거'}),
    (r'^打开 (.+\.(?:pdf|md|markdown|mdown|mkdn?|mdwn))$', {'en': 'Open $1', 'zh-TW': '開啟 $1', 'ja': '$1 を開く', 'ko': '$1 열기'}),
    (r'^关闭 (.+)$', {'en': 'Close $1', 'zh-TW': '關閉 $1', 'ja': '$1 を閉じる', 'ko': '$1 닫기'}),
    # 0.16.0 首页样式
    (r'^(\d+) 分钟前$', {'en': '$1 min ago', 'zh-TW': '$1 分鐘前', 'ja': '$1 分前', 'ko': '$1분 전'}),
    (r'^(\d+) 条摘录$', {'en': '$1 excerpts', 'zh-TW': '$1 條摘錄', 'ja': '抜粋 $1 件', 'ko': '발췌 $1개'}),
    (r'^第 (\d+) 页的摘录$', {'en': 'Excerpt on page $1', 'zh-TW': '第 $1 頁的摘錄', 'ja': '$1 ページの抜粋', 'ko': '$1쪽 발췌'}),
    (r'^第 (\d+) 页$', {'en': 'Page $1', 'zh-TW': '第 $1 頁', 'ja': '$1 ページ', 'ko': '$1쪽'}),
    (r'^(\d+) 份最近文档，全在本机$', {'en': '$1 recent documents, all on this computer', 'zh-TW': '$1 份最近文件，全在本機', 'ja': '最近の文書 $1 件、すべてこのPC内', 'ko': '최근 문서 $1개, 모두 이 컴퓨터에'}),
    (r'^翻到第 (\d+) 页$', {'en': 'Go to page $1', 'zh-TW': '翻到第 $1 頁', 'ja': '$1 ページへ', 'ko': '$1쪽으로'}),
    (r'^(\d+) 页$', {'en': '$1 pages', 'zh-TW': '$1 頁', 'ja': '$1 ページ', 'ko': '$1쪽'}),
    (r'^本周 (\d+) 条$', {'en': '$1 this week', 'zh-TW': '本週 $1 條', 'ja': '今週 $1 件', 'ko': '이번 주 $1개'}),
    (r'^回到原文 (.+)$', {'en': 'Back to the source: $1', 'zh-TW': '回到原文 $1', 'ja': '原文に戻る：$1', 'ko': '원문으로: $1'}),
    (r'^第 (\d+) / (\d+) 页(.*)$', {'en': 'Page $1 / $2$3', 'zh-TW': '第 $1 / $2 頁$3', 'ja': '$1 / $2 ページ$3', 'ko': '$1 / $2페이지$3'}),
    (r'^ · 有未保存批注$', {'en': ' · unsaved annotations', 'zh-TW': ' · 有未儲存批註', 'ja': ' · 未保存の注釈あり', 'ko': ' · 저장되지 않은 주석'}),
    (r'^已替换 (\d+) 处 · 可撤销$', {'en': 'Replaced $1 · undoable', 'zh-TW': '已取代 $1 處 · 可復原', 'ja': '$1 件を置換 · 元に戻せます', 'ko': '$1개 바꿈 · 실행 취소 가능'}),
    (r'^正在导出 (.+)…$', {'en': 'Exporting $1…', 'zh-TW': '正在匯出 $1…', 'ja': '$1 を書き出しています…', 'ko': '$1 내보내는 중…'}),
    (r'^已恢复 (.+) 的未保存内容$', {'en': 'Restored unsaved content of $1', 'zh-TW': '已還原 $1 的未儲存內容', 'ja': '$1 の未保存の内容を復元しました', 'ko': '$1의 저장되지 않은 내용을 복원했습니다'}),
    (r'^发现未正常关闭的会话：(.+)（(\d+) 份草稿）$', {'en': 'Found a session that did not close normally: $1 ($2 drafts)', 'zh-TW': '發現未正常關閉的工作階段：$1（$2 份草稿）', 'ja': '正常に終了しなかったセッションがあります：$1（下書き $2 件）', 'ko': '정상적으로 종료되지 않은 세션: $1(초안 $2개)'}),
    (r'^换行符将在下次保存时改为 (.+)$', {'en': 'Line endings will change to $1 at the next save', 'zh-TW': '換行符號將在下次儲存時改為 $1', 'ja': '次回の保存時に改行コードを $1 に変更します', 'ko': '다음 저장 시 줄 끝이 $1(으)로 바뀝니다'}),
    (r'^已用 (.+) 重新读取文件$', {'en': 'Reopened the file as $1', 'zh-TW': '已用 $1 重新讀取檔案', 'ja': '$1 でファイルを開き直しました', 'ko': '$1(으)로 파일을 다시 열었습니다'}),
    (r'^已复制 (\d+) 张图片，并更新了链接 · 可撤销$', {'en': 'Copied $1 images and updated the links · undoable', 'zh-TW': '已複製 $1 張圖片，並更新了連結 · 可復原', 'ja': '$1 枚の画像をコピーしリンクを更新しました · 元に戻せます', 'ko': '이미지 $1개를 복사하고 링크를 업데이트했습니다 · 실행 취소 가능'}),
    (r'^已保存 (\d+) 个文件(.*)$', {'en': 'Saved $1 files$2', 'zh-TW': '已儲存 $1 個檔案$2', 'ja': '$1 個のファイルを保存しました$2', 'ko': '파일 $1개를 저장했습니다$2'}),
    (r'^主题文件夹中有 (\d+) 个自定义主题，可在“主题”菜单选择$', {'en': '$1 custom themes in the themes folder; choose them from the "Theme" menu', 'zh-TW': '主題資料夾中有 $1 個自訂主題，可在「主題」功能表選擇', 'ja': 'テーマフォルダーに $1 個のカスタムテーマがあります。「テーマ」メニューから選べます', 'ko': '테마 폴더에 사용자 지정 테마 $1개가 있습니다. "테마" 메뉴에서 선택하세요'}),
    (r'^(专注模式|打字机模式)：(开|关)$', {'en': '$1: $2', 'zh-TW': '$1：$2', 'ja': '$1：$2', 'ko': '$1: $2'}),
    # 0.10.0 notes mode, 0.11.0 links / library search / references
    (r'^左侧：(.+)$', {'en': 'Left: $1', 'zh-TW': '左側：$1', 'ja': '左側：$1', 'ko': '왼쪽: $1'}),
    (r'^已摘录到 (.+) · 可撤销，尚未保存$', {'en': 'Excerpted to $1 · can be undone, not saved yet', 'zh-TW': '已摘錄到 $1 · 可復原，尚未儲存', 'ja': '$1 に抜粋しました · 元に戻せます、未保存', 'ko': '$1에 발췌함 · 실행 취소 가능, 아직 저장되지 않음'}),
    (r'^已整理到 (.+) · 可撤销，尚未保存$', {'en': 'Added to $1 · can be undone, not saved yet', 'zh-TW': '已整理到 $1 · 可復原，尚未儲存', 'ja': '$1 に追加しました · 元に戻せます、未保存', 'ko': '$1에 추가함 · 실행 취소 가능, 아직 저장되지 않음'}),
    (r'^已把第 (\d+) 页的区域摘录到 (.+) · 可撤销，尚未保存$', {'en': 'Region of page $1 excerpted into $2 · undoable, not saved yet', 'zh-TW': '已把第 $1 頁的區域摘錄到 $2 · 可復原，尚未儲存', 'ja': '$1 ページの範囲を $2 へ抜粋しました · 元に戻せます、未保存', 'ko': '$1쪽의 영역을 $2에 발췌했습니다 · 실행 취소 가능, 저장 안 됨'}),
    (r'^笔记里已经有全部 (\d+) 条批注$', {'en': 'The note already has all $1 annotations', 'zh-TW': '筆記裡已經有全部 $1 條批註', 'ja': 'ノートにはすでに $1 件の注釈がすべてあります', 'ko': '노트에 이미 주석 $1개가 모두 있습니다'}),
    (r'^已同步 (\d+) 条批注到 (.+?)(?:（(\d+) 条已在笔记中）)? · 可撤销，尚未保存$', {'en': '$1 annotations synced into $2 · undoable, not saved yet', 'zh-TW': '已同步 $1 條批註到 $2 · 可復原，尚未儲存', 'ja': '$1 件の注釈を $2 へ同期しました · 元に戻せます、未保存', 'ko': '주석 $1개를 $2에 동기화했습니다 · 실행 취소 가능, 저장 안 됨'}),
    (r'^找到 (\d+) 处 · (\d+) 个文档$', {'en': '$1 matches in $2 documents', 'zh-TW': '找到 $1 處 · $2 個文件', 'ja': '$1 件 · $2 文書', 'ko': '$1곳 · 문서 $2개'}),
    (r'^找到 (\d+) 处 · (\d+) 个文档 · 还有 (\d+) 个文档正在建立索引$', {'en': '$1 matches in $2 documents · $3 documents still being indexed', 'zh-TW': '找到 $1 處 · $2 個文件 · 還有 $3 個文件正在建立索引', 'ja': '$1 件 · $2 文書 · あと $3 文書を索引作成中', 'ko': '$1곳 · 문서 $2개 · 문서 $3개 색인 중'}),
    (r'^暂未找到，还有 (\d+) 个文档正在建立索引$', {'en': 'Nothing yet; $1 documents are still being indexed', 'zh-TW': '暫未找到，還有 $1 個文件正在建立索引', 'ja': 'まだ見つかりません。あと $1 文書を索引作成中', 'ko': '아직 없습니다. 문서 $1개 색인 중'}),
    (r'^正在读取 (.+)（剩余 (\d+) 个）$', {'en': 'Reading $1 ($2 left)', 'zh-TW': '正在讀取 $1（剩餘 $2 個）', 'ja': '$1 を読み込み中（残り $2）', 'ko': '$1 읽는 중($2개 남음)'}),
    (r'^正在为 (\d+) 个文档建立索引…$', {'en': 'Indexing $1 documents…', 'zh-TW': '正在為 $1 個文件建立索引…', 'ja': '$1 文書の索引を作成中…', 'ko': '문서 $1개 색인 중…'}),
    (r'^已索引 (\d+) 个文档 · 索引只保存在本机$', {'en': '$1 documents indexed · the index stays on this computer', 'zh-TW': '已索引 $1 個文件 · 索引只儲存在本機', 'ja': '$1 文書を索引済み · 索引はこのコンピューターにのみ保存されます', 'ko': '문서 $1개 색인됨 · 색인은 이 컴퓨터에만 저장됩니다'}),
    (r'^(\d+) 处$', {'en': '$1 matches', 'zh-TW': '$1 處', 'ja': '$1 件', 'ko': '$1곳'}),
    (r'^第 (\d+) 行$', {'en': 'Line $1', 'zh-TW': '第 $1 行', 'ja': '$1 行目', 'ko': '$1행'}),
    (r'^其余 (\d+) 处请打开文档后用 Ctrl\+F 查看$', {'en': 'Open the document and press Ctrl+F for the other $1 matches', 'zh-TW': '其餘 $1 處請開啟文件後用 Ctrl+F 檢視', 'ja': '残り $1 件は文書を開いて Ctrl+F で確認してください', 'ko': '나머지 $1곳은 문서를 열고 Ctrl+F로 확인하세요'}),
    (r'^已定位到 (.+) 第 (\d+) 行$', {'en': 'Went to $1, line $2', 'zh-TW': '已定位到 $1 第 $2 行', 'ja': '$1 の $2 行目へ移動しました', 'ko': '$1의 $2행으로 이동했습니다'}),
    (r'^已定位到 (.+) 第 (\d+) 页$', {'en': 'Went to $1, page $2', 'zh-TW': '已定位到 $1 第 $2 頁', 'ja': '$1 の $2 ページへ移動しました', 'ko': '$1의 $2쪽으로 이동했습니다'}),
    (r'^索引未完成：(.+)$', {'en': 'Indexing did not finish: $1', 'zh-TW': '索引未完成：$1', 'ja': '索引の作成が完了しませんでした：$1', 'ko': '색인이 완료되지 않았습니다: $1'}),
    (r'^已把引用插入 (.+) · 可撤销，尚未保存$', {'en': 'Reference inserted into $1 · undoable, not saved yet', 'zh-TW': '已把引用插入 $1 · 可復原，尚未儲存', 'ja': '参考文献を $1 に挿入しました · 元に戻せます、未保存', 'ko': '참고문헌을 $1에 삽입했습니다 · 실행 취소 가능, 저장 안 됨'}),
    (r'^已导出 (\d+) 条文献到 (.+)$', {'en': '$1 references exported to $2', 'zh-TW': '已匯出 $1 條文獻到 $2', 'ja': '$1 件の文献を $2 に書き出しました', 'ko': '문헌 $1개를 $2에 내보냈습니다'}),
    (r'^doi\.org 返回了错误（(\d+)）。$', {'en': 'doi.org answered with an error ($1).', 'zh-TW': 'doi.org 傳回了錯誤（$1）。', 'ja': 'doi.org がエラーを返しました（$1）。', 'ko': 'doi.org가 오류를 반환했습니다($1).'}),
]
SINGLE = {'开': {'en': 'on', 'zh-TW': '開', 'ja': 'オン', 'ko': '켬'}, '关': {'en': 'off', 'zh-TW': '關', 'ja': 'オフ', 'ko': '끔'}}
# Catalog fragments used as prefixes of longer runtime strings ("已复制路径：C:\…").
PREFIXES = lambda s: s.endswith('：') or s.endswith(':')

for li, lang in enumerate(LANGS):
    strings, prefix_patterns = {}, []
    for i, src in enumerate(catalog):
        tr = rows[i][li]
        if tr == '-' or not tr.strip(): continue
        key = src.replace('\\n', '\n')
        val = tr.replace('⏎', '\n').replace('\\n', '\n')
        strings[key.strip()] = val.strip() if not val.startswith(' ') and not val.endswith(' ') else val
        if PREFIXES(key.strip()): prefix_patterns.append(['^' + re.escape(key.strip()) + r'\s*(.+)$', val.rstrip() + ('' if val.rstrip().endswith((' ', '：', '（')) else ' ') + '$1'])
    for k, v in SINGLE.items(): strings[k] = v[lang]
    pats = [[re_, reps[lang]] for re_, reps in PATTERNS] + prefix_patterns
    out = {'language': lang, 'name': NAMES[lang], 'strings': strings, 'patterns': pats}
    (ROOT / 'ui' / 'i18n' / f'{lang}.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(lang, len(strings), 'strings', len(pats), 'patterns')
