// ===================================================================
// 번역문 내보내기 (translation-copy)
// 번역문(message.extra.display_text)과
// 원문(message.mes)을 범위 지정하여 클립보드 복사 / txt 저장하는 확장
// ===================================================================

import { getContext } from '../../../extensions.js';

const EXTENSION_NAME = '번역문 내보내기';

// ─────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────

function getLastIndex() {
    try {
        const ctx = getContext();
        return ctx?.chat?.length ? ctx.chat.length - 1 : 0;
    } catch {
        return 0;
    }
}

/**
 * 원문(msg.mes) 처리 - 순수 텍스트이므로 정규식 기반
 * 'keep'   - 원본 그대로
 * 'strip'  - 코드블록 제거 + HTML 태그 제거, 텍스트 보존
 * 'remove' - 코드블록 제거 + XML/HTML 태그+내용 전체 제거
 */
function applyHtmlModeToOriginal(text, htmlMode) {
    if (!text) return text;
    if (htmlMode === 'keep') return text;

    // 1. 마크다운 코드블록 통째로 제거
    let result = text.replace(/```[\s\S]*?```/g, '');
    // 2. {{img::...}} 제거
    result = result.replace(/\{\{img::[^}]*\}\}/gi, '');

    if (htmlMode === 'remove') {
        let prev;
        do {
            prev = result;
            result = result.replace(/<([A-Za-z][A-Za-z0-9]*)[^>]*>[\s\S]*?<\/\1>/g, '');
        } while (result !== prev);
        result = result.replace(/<[^>]+>/g, '');
        return result.trim() || null;
    }

    // strip: 태그만 제거
    result = result.replace(/<[^>]+>/g, '');
    return result.trim() || result;
}

/**
 * 번역문(msg.extra.display_text) 처리
 * llm-translator는 display_text를 HTML로 렌더링해서 저장함
 * 마크다운 코드블록은 <pre><code>...</code></pre> 형태로 변환되어 있음
 * <status>/<choices> 등 커스텀 태그는 비표준이라 브라우저 DOM이 내용을 노출시킴
 *
 * 'keep'   - 원본 그대로
 * 'strip'  - 정규식으로 커스텀 태그 블록 제거 후,
 *            DOM에서 pre/code/script/style 제거 후 innerText 추출
 * 'remove' - 정규식으로 커스텀 태그 블록 먼저 제거 후,
 *            DOM에서 pre/code/script/style 제거 후 innerText 추출
 *            → 결과적으로 커스텀 태그 내용 + 코드블록 모두 제거
 */
function applyHtmlModeToTranslation(text, htmlMode) {
    if (!text) return null;
    if (htmlMode === 'keep') return text;

    if (htmlMode === 'remove') {
        // 태그+내용 전체 제거: 정규식으로 <태그>...</태그> 반복 제거
        let result = text;
        let prev;
        do {
            prev = result;
            result = result.replace(/<([A-Za-z][A-Za-z0-9]*)[^>]*>[\s\S]*?<\/\1>/g, '');
        } while (result !== prev);
        result = result.replace(/<[^>]+>/g, '');
        result = result.replace(/\{\{img::[^}]*\}\}/gi, '');
        return result.trim() || null;
    }

    // 'strip': 태그 기호만 제거, 내용 보존
    // display_text는 이미 HTML 렌더링된 형태 → DOM innerText로 추출
    // 단, <pre>/<code>/<script>/<style>은 코드블록이므로 통째로 제거
    const tmp = document.createElement('div');
    tmp.innerHTML = text;
    ['pre', 'code', 'script', 'style'].forEach(sel => {
        tmp.querySelectorAll(sel).forEach(el => el.remove());
    });
    let result = tmp.innerText || tmp.textContent || '';
    result = result.replace(/\{\{img::[^}]*\}\}/gi, '');
    return result.trim() || result;
}






// ─────────────────────────────────────────────
// 공백 정리 (HTML 잔재 스페이스/탭 줄 제거 후 연속 빈 줄 압축)
// ─────────────────────────────────────────────

function cleanupWhitespace(text) {
    if (!text || !text.trim()) return text;
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[ \t]+$/gm, '')        // 각 줄 끝 스페이스/탭 제거
        .replace(/^[ \t]+$/gm, '')       // 스페이스/탭만 있는 줄 → 빈 줄
        .replace(/\n{3,}/g, '\n\n')      // 3줄 이상 빈 줄 → 2줄로
        .trim();
}

// ─────────────────────────────────────────────
// 핵심: 범위 내 메시지 수집
// ─────────────────────────────────────────────

/**
 * 한 메시지를 지정된 contentMode로 포맷팅
 * contentMode: 'translation' | 'original' | 'both' | 'exclude'
 * 반환: 문자열 배열(여러 줄) 또는 null(제외/내용없음)
 */
function formatMessage(i, msg, contentMode, htmlMode) {
    if (contentMode === 'exclude') return null;

    const name = msg.name || (msg.is_user ? '나' : 'AI');
    const original = applyHtmlModeToOriginal(msg.mes || '', htmlMode) || '';
    const translation = applyHtmlModeToTranslation(msg.extra?.display_text, htmlMode);

    const out = [];
    if (contentMode === 'original') {
        if (original) out.push(`[${i}] ${name}:\n${original}\n`);
    } else if (contentMode === 'translation') {
        out.push(`[${i}] ${name}:\n${translation ?? '(번역 없음)'}\n`);
    } else { // 'both'
        out.push(`[${i}] ${name}:`);
        out.push(`[원문]\n${original}`);
        out.push('');  // 원문과 번역 사이 한 줄 공백
        out.push(`[번역]\n${translation ?? '(번역 없음)'}`);
        out.push('');
    }
    return out;
}

/**
 * @param modeConf 일괄 또는 발신자별 설정 객체
 *   { type: 'uniform', mode } 또는
 *   { type: 'bySender', userMode, aiMode }
 *
 * 발신자 구분 기준:
 *   - 유저 메시지: msg.is_user === true (사용자가 직접 입력한 것)
 *   - AI/기타 메시지: msg.is_user !== true
 *       (AI 답변 + /gen, /send 등 슬래시 명령 생성물 + 시스템 메시지 전부 포함)
 *   이렇게 하면 {{char}} 이름이 아닌 메시지도 안전하게 AI 쪽으로 분류됨
 */
function collectMessages(start, end, modeConf, hiddenMode, htmlMode) {
    const ctx = getContext();
    if (!ctx?.chat?.length) {
        toastr.error('현재 채팅이 없습니다.');
        return null;
    }

    const chat = ctx.chat;
    const actualEnd = Math.min(end, chat.length - 1);
    const lines = [];

    for (let i = start; i <= actualEnd; i++) {
        const msg = chat[i];
        if (!msg) continue;

        // SillyTavern /hide: is_system + DOM display:none 이중 검증
        const isSystemHidden = !!msg.is_system;
        const domEl = document.querySelector(`#chat .mes[mesid="${i}"]`);
        const isDomHidden = domEl
            ? (domEl.style.display === 'none' || getComputedStyle(domEl).display === 'none')
            : false;
        const isHidden = isSystemHidden || isDomHidden;

        if (hiddenMode === 'skip' && isHidden) continue;
        if (hiddenMode === 'only' && !isHidden) continue;

        // 발신자별 모드면 메시지 주체에 따라 contentMode 결정
        let contentMode;
        if (modeConf.type === 'bySender') {
            const isUser = msg.is_user === true;
            contentMode = isUser ? modeConf.userMode : modeConf.aiMode;
        } else {
            contentMode = modeConf.mode;
        }

        const formatted = formatMessage(i, msg, contentMode, htmlMode);
        if (formatted) lines.push(...formatted);
    }

    if (!lines.length) {
        toastr.warning('선택 범위에 해당하는 메시지가 없습니다.');
        return null;
    }

    return lines.join('\n');
}

// ─────────────────────────────────────────────
// 클립보드 복사
// ─────────────────────────────────────────────

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        toastr.success('클립보드에 복사되었습니다!');
    } catch {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            toastr.success('클립보드에 복사되었습니다! (fallback)');
        } catch (e2) {
            toastr.error('클립보드 복사 실패: ' + e2.message);
        }
    }
}

// ─────────────────────────────────────────────
// TXT 저장
// ─────────────────────────────────────────────

function saveAsTxt(text, mode) {
    const modeLabel = { original: '원문', translation: '번역', both: '원문+번역', '발신자별': '발신자별' }[mode] || mode;
    const filename = `번역내보내기_${modeLabel}_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toastr.success(`"${filename}" 으로 저장되었습니다!`);
}

// ─────────────────────────────────────────────
// 공통 입력값 파싱
// ─────────────────────────────────────────────

function getInputValues() {
    let start = parseInt($('#tranexp_start').val());
    let end   = parseInt($('#tranexp_end').val());
    const lastIdx = getLastIndex();

    if (isNaN(start) || $('#tranexp_start').val().trim() === '') start = 0;
    if (isNaN(end)   || $('#tranexp_end').val().trim() === '')   end   = lastIdx;

    if (start < 0) start = 0;
    if (end > lastIdx) end = lastIdx;
    if (start > end) {
        toastr.error('시작 번호가 끝 번호보다 큽니다.');
        return null;
    }

    $('#tranexp_start').val(start);
    $('#tranexp_end').val(end);

    const hiddenMode = $('#tranexp_hidden').val() || 'skip';
    const htmlMode   = $('#tranexp_html').val()   || 'strip';

    // 일괄 / 발신자별 분기
    const applyType = $('#tranexp_applytype').val() || 'uniform';
    let modeConf;
    if (applyType === 'bySender') {
        const userMode = $('#tranexp_user_mode').val() || 'both';
        const aiMode   = $('#tranexp_ai_mode').val()   || 'both';
        modeConf = { type: 'bySender', userMode, aiMode };
    } else {
        const mode = $('#tranexp_mode').val() || 'translation';
        modeConf = { type: 'uniform', mode };
    }
    return { start, end, modeConf, hiddenMode, htmlMode };
}

// ─────────────────────────────────────────────
// 버튼 핸들러
// ─────────────────────────────────────────────

function handleLoadPreview() {
    const vals = getInputValues();
    if (!vals) return;
    const text = collectMessages(vals.start, vals.end, vals.modeConf, vals.hiddenMode, vals.htmlMode);
    if (text !== null) $('#tranexp_preview').val(text);
}

function handleCleanup() {
    const $preview = $('#tranexp_preview');
    const current = $preview.val();
    if (!current.trim()) { toastr.warning('미리보기에 내용이 없습니다.'); return; }
    const cleaned = cleanupWhitespace(current);
    $preview.prop('readonly', false);
    $preview.val(cleaned);
    $preview.prop('readonly', true);
    if (cleaned.length < current.length) {
        toastr.success('공백 정리 완료!');
    } else {
        toastr.info('정리할 공백이 없습니다.');
    }
}

function getTextForExport(vals) {
    // 미리보기에 내용이 있으면 그걸 우선 사용 (공백 정리 등 편집 반영)
    // 없으면 새로 수집
    const preview = $('#tranexp_preview').val();
    if (preview && preview.trim()) return preview;
    return collectMessages(vals.start, vals.end, vals.modeConf, vals.hiddenMode, vals.htmlMode);
}

function handleCopy() {
    const vals = getInputValues();
    if (!vals) return;
    const text = getTextForExport(vals);
    if (text) copyToClipboard(text);
}

function handleSave() {
    const vals = getInputValues();
    if (!vals) return;
    const text = getTextForExport(vals);
    if (text) {
        const label = vals.modeConf.type === 'bySender'
            ? '발신자별'
            : vals.modeConf.mode;
        saveAsTxt(text, label);
    }
}

// ─────────────────────────────────────────────
// UI 세팅패널 주입
// ─────────────────────────────────────────────

async function loadSettingsUI() {
    const settingsHtml = `
<div id="tranexp_settings" class="extension_settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>번역문 내보내기</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down"></div>
        </div>
        <div class="inline-drawer-content" style="display:none;">

            <!-- 메시지 범위 -->
            <div class="tranexp_row">
                <span class="tranexp_label">메시지 범위</span>
                <div class="tranexp_range_wrap">
                    <input id="tranexp_start" type="number" min="0" placeholder="시작" class="tranexp_num_input" />
                    <span>~</span>
                    <input id="tranexp_end" type="number" min="0" placeholder="끝" class="tranexp_num_input" />
                    <button id="tranexp_btn_fillmax" class="menu_button tranexp_small_btn" title="끝 번호를 마지막 메시지로 채우기">마지막</button>
                </div>
            </div>

            <!-- 옵션 그리드 -->
            <!-- 옵션 그리드 (드롭다운) -->
            <div class="tranexp_grid">

                <span class="tranexp_grid_label">숨김 메시지</span>
                <select id="tranexp_hidden" class="tranexp_select">
                    <option value="skip" selected>제외</option>
                    <option value="include">포함</option>
                    <option value="only">숨김만</option>
                </select>

                <span class="tranexp_grid_label">적용 방식</span>
                <select id="tranexp_applytype" class="tranexp_select">
                    <option value="uniform" selected>일괄</option>
                    <option value="bySender">발신자별</option>
                </select>

                <span class="tranexp_grid_label" id="tranexp_uniform_label">내보낼 내용</span>
                <select id="tranexp_mode" class="tranexp_select" data-row="uniform">
                    <option value="translation" selected>번역문만</option>
                    <option value="original">원문만</option>
                    <option value="both">원문+번역</option>
                </select>

                <span class="tranexp_grid_label tranexp_sender_row" style="display:none;">유저 메시지</span>
                <select id="tranexp_user_mode" class="tranexp_select tranexp_sender_row" style="display:none;">
                    <option value="translation">번역문만</option>
                    <option value="original" selected>원문만</option>
                    <option value="both">원문+번역</option>
                    <option value="exclude">제외</option>
                </select>

                <span class="tranexp_grid_label tranexp_sender_row" style="display:none;">AI 메시지</span>
                <select id="tranexp_ai_mode" class="tranexp_select tranexp_sender_row" style="display:none;">
                    <option value="translation" selected>번역문만</option>
                    <option value="original">원문만</option>
                    <option value="both">원문+번역</option>
                    <option value="exclude">제외</option>
                </select>

                <span class="tranexp_grid_label">HTML 옵션</span>
                <select id="tranexp_html" class="tranexp_select">
                    <option value="strip" selected>태그만삭제</option>
                    <option value="keep">미삭제</option>
                    <option value="remove">전체삭제</option>
                </select>

            </div>

            <!-- 미리보기 -->
            <div class="tranexp_row">
                <span class="tranexp_label">미리보기</span>
                <button id="tranexp_btn_preview" class="menu_button tranexp_small_btn">불러오기</button>
            </div>
            <textarea id="tranexp_preview" class="tranexp_preview_area" readonly placeholder="'불러오기' 버튼을 눌러 내용을 확인하세요."></textarea>
            <div class="tranexp_clear_row">
                <button id="tranexp_btn_cleanup" class="menu_button tranexp_small_btn tranexp_clear_btn">🧹 공백 정리</button>
                <button id="tranexp_btn_clear" class="menu_button tranexp_small_btn tranexp_clear_btn">🗑 비우기</button>
            </div>

            <!-- 실행 버튼 -->
            <div class="tranexp_action_row">
                <button id="tranexp_btn_copy" class="menu_button">📋 클립보드 복사</button>
                <button id="tranexp_btn_save" class="menu_button">💾 TXT 저장</button>
            </div>

        </div>
    </div>
</div>`;

    $('#extensions_settings').append(settingsHtml);

    $('#tranexp_btn_fillmax').on('click', () => {
        $('#tranexp_end').val(getLastIndex());
    });

    $('#tranexp_btn_preview').on('click', handleLoadPreview);
    $('#tranexp_btn_cleanup').on('click', handleCleanup);

    $('#tranexp_btn_clear').on('click', () => {
        $('#tranexp_preview').val('');
        toastr.info('미리보기를 비웠습니다.');
    });

    // 적용 방식(일괄/발신자별) 전환 시 하위 메뉴 토글
    $('#tranexp_applytype').on('change', function () {
        const isBySender = $(this).val() === 'bySender';
        if (isBySender) {
            $('#tranexp_uniform_label, #tranexp_mode').hide();
            $('.tranexp_sender_row').show();
        } else {
            $('#tranexp_uniform_label, #tranexp_mode').show();
            $('.tranexp_sender_row').hide();
        }
    });

    $('#tranexp_btn_copy').on('click', handleCopy);
    $('#tranexp_btn_save').on('click', handleSave);
}

// ─────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────

jQuery(async () => {
    await loadSettingsUI();
    console.log(`[${EXTENSION_NAME}] 로드 완료`);
});
