// ===================================================================
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

function applyHtmlModeToOriginal(text, htmlMode) {
    if (!text) return text;
    if (htmlMode === 'keep') return text;

    let result = text.replace(/```[\s\S]*?```/g, '');
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

    result = result.replace(/<[^>]+>/g, '');
    return result.trim() || result;
}

function applyHtmlModeToTranslation(text, htmlMode) {
    if (!text) return null;
    if (htmlMode === 'keep') return text;

    if (htmlMode === 'remove') {
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
        .replace(/[ \t]+$/gm, '')
        .replace(/^[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ─────────────────────────────────────────────
// 핵심: 범위 내 메시지 수집
// ─────────────────────────────────────────────

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
        out.push('');
        out.push(`[번역]\n${translation ?? '(번역 없음)'}`);
        out.push('');
    }
    return out;
}

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

        const isSystemHidden = !!msg.is_system;
        const domEl = document.querySelector(`#chat .mes[mesid="${i}"]`);
        const isDomHidden = domEl
            ? (domEl.style.display === 'none' || getComputedStyle(domEl).display === 'none')
            : false;
        const isHidden = isSystemHidden || isDomHidden;

        if (hiddenMode === 'skip' && isHidden) continue;
        if (hiddenMode === 'only' && !isHidden) continue;

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
// 단어 치환
// ─────────────────────────────────────────────

let slotIdCounter = 0;

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function applySlotReplacement($slot) {
    const $preview = $('#tranexp_preview');
    const current = $preview.val();
    if (!current.trim()) {
        toastr.warning("먼저 '불러오기'로 미리보기에 내용을 표시하세요.");
        return;
    }
    const from = $slot.find('.tranexp_slot_from').val();
    const to = $slot.find('.tranexp_slot_to').val() ?? '';
    if (from === '' || from == null) {
        toastr.warning('찾을 단어를 입력하세요.');
        return;
    }
    const re = new RegExp(escapeRegExp(from), 'g');
    const replaced = current.replace(re, to);
    if (replaced === current) {
        toastr.info('바꿀 대상이 없습니다.');
        return;
    }
    $preview.prop('readonly', false);
    $preview.val(replaced);
    $preview.prop('readonly', true);
    toastr.success('치환 적용됨');
}

function addReplacementSlot() {
    const id = ++slotIdCounter;
    const slotHtml = `
<div class="tranexp_slot" data-id="${id}">
    <input type="text" class="tranexp_slot_from" placeholder="찾을 단어" />
    <span class="tranexp_slot_arrow">→</span>
    <input type="text" class="tranexp_slot_to" placeholder="바꿀 단어" />
    <button class="tranexp_slot_btn tranexp_slot_apply" title="지금 미리보기에 치환 적용">✓</button>
    <button class="tranexp_slot_btn tranexp_slot_delete" title="슬롯 삭제">✗</button>
</div>`;
    const $slot = $(slotHtml);
    $('#tranexp_slot_list').append($slot);

    $slot.find('.tranexp_slot_apply').on('click', () => applySlotReplacement($slot));
    $slot.find('.tranexp_slot_delete').on('click', () => $slot.remove());
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

            <!-- 단어 치환 (접힘 메뉴) -->
            <div class="tranexp_replace_wrap">
                <div class="tranexp_replace_header" id="tranexp_replace_toggle">
                    <span class="tranexp_replace_arrow">▶</span>
                    <b>단어 치환</b>
                </div>
                <div class="tranexp_replace_body" id="tranexp_replace_body" style="display:none;">
                    <div id="tranexp_slot_list"></div>
                    <button id="tranexp_btn_add_slot" class="menu_button tranexp_small_btn">＋ 슬롯 추가</button>
                </div>
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

    $('#tranexp_replace_toggle').on('click', () => {
        const $body = $('#tranexp_replace_body');
        const isHidden = $body.is(':hidden');
        $body.toggle();
        $('.tranexp_replace_arrow').text(isHidden ? '▼' : '▶');
    });
    $('#tranexp_btn_add_slot').on('click', addReplacementSlot);

    $('#tranexp_btn_clear').on('click', () => {
        $('#tranexp_preview').val('');
        toastr.info('미리보기를 비웠습니다.');
    });

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
