// Логика взята из excel_script.js и адаптирована под папку new/ и файл data.xlsx

const $fio = document.getElementById('fio');
const $btn = document.getElementById('findBtn');
const $addresses = document.getElementById('addresses');
const $container = document.querySelector('.container');

let excelData = { выборка: null, тексты: null, доставки: null };
let restaurantTexts = null;

// Управление состояниями выполнения ресторанов
function getCompletionKey(partner, restaurant, method) {
  return `${partner}_${restaurant}_${method}`.replace(/\s+/g, '_');
}

function getCompletionStatus(partner, restaurant, method) {
  const key = getCompletionKey(partner, restaurant, method);
  return localStorage.getItem(`completion_${key}`) === 'true';
}

async function setCompletionStatus(partner, restaurant, method, completed) {
  const key = getCompletionKey(partner, restaurant, method);
  if (completed) {
    localStorage.setItem(`completion_${key}`, 'true');
  } else {
    localStorage.removeItem(`completion_${key}`);
  }
  try {
    await fetch('/api/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fio: document.getElementById('fio').value.trim(), partner, restaurant, method, completed })
    });
  } catch (_) {}
}

function toggleCompletion(partner, restaurant, method) {
  const currentStatus = getCompletionStatus(partner, restaurant, method);
  setCompletionStatus(partner, restaurant, method, !currentStatus);
  return !currentStatus;
}

const statusIndicator = document.createElement('div');
statusIndicator.className = 'status-indicator';
document.body.appendChild(statusIndicator);

function normalizeString(text) {
  if (!text) return '';
  return text.toString().toLowerCase().replace(/\s+/g, '').replace(/ё/g, 'е');
}

function htmlEscape(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function showStatus(message, isError = false) {
  statusIndicator.textContent = message;
  statusIndicator.className = `status-indicator ${isError ? 'error' : 'success'} show`;
  setTimeout(() => statusIndicator.classList.remove('show'), 3000);
}

function showLoading(button, text = 'Загрузка...') {
  const originalText = button.textContent;
  button.disabled = true;
  button.innerHTML = `<span class="loading">${text}</span>`;
  return originalText;
}

function hideLoading(button, originalText) {
  button.disabled = false;
  button.textContent = originalText;
}

async function loadRestaurantTexts() {
  try {
    const response = await fetch('restaurant-texts.json');
    if (!response.ok) {
      throw new Error('Не удалось загрузить файл с текстами');
    }
    restaurantTexts = await response.json();
    return true;
  } catch (e) {
    console.error('Ошибка загрузки текстов:', e);
    showStatus('Ошибка загрузки текстов', true);
    return false;
  }
}

async function loadExcelFile() {
  try {
    if (location.protocol === 'file:') {
      showStatus('Откройте через http://localhost/ (не file://)', true);
      return false;
    }

    // Загружаем JSON с текстами параллельно
    const textsPromise = loadRestaurantTexts();

    // Сначала ищем рядом со страницей (new/data.xlsx), затем пробуем из корня проекта
    const candidatePaths = ['data.xlsx', 'Таблица для загрузки.xlsx', '../data.xlsx', '../Таблица для загрузки.xlsx'];
    const withBust = (p) => `${p}${p.includes('?') ? '&' : '?'}v=${Date.now()}`;
    let response = null;
    for (const path of candidatePaths) {
      try {
        const r = await fetch(encodeURI(withBust(path)), { cache: 'no-store' });
        if (r.ok) { response = r; break; }
      } catch (_) {}
    }
    if (!response) { throw new Error('Excel не найден рядом со страницей'); }

    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });

    if (workbook.SheetNames.includes('Выборка')) {
      excelData.выборка = XLSX.utils.sheet_to_json(workbook.Sheets['Выборка']);
    } else {
      showStatus('Нет листа "Выборка"', true);
      return false;
    }

    if (workbook.SheetNames.includes('Тексты')) {
      excelData.тексты = XLSX.utils.sheet_to_json(workbook.Sheets['Тексты'], { header: 1 });
    } else {
      // Лист "Тексты" может быть в подготовке — не блокируем работу, просто не будет инструкций
      excelData.тексты = [];
    }

    // Адреса доставок — берем сервис оформления
    if (workbook.SheetNames.includes('Адреса доставок')) {
      excelData.доставки = XLSX.utils.sheet_to_json(workbook.Sheets['Адреса доставок']);
    } else {
      excelData.доставки = [];
    }

    // Ждем загрузки текстов
    await textsPromise;

    showStatus(`Excel загружен (${excelData.выборка.length})`);
    return true;
  } catch (e) {
    console.error(e);
    showStatus('Ошибка загрузки Excel', true);
    return false;
  }
}

async function findAssignments(fio) {
  if (!excelData.выборка) {
    const ok = await loadExcelFile();
    if (!ok) return [];
  }

  const normalizedFio = normalizeString(fio);

  const results = [];
  excelData.выборка.forEach(row => {
    const tester = normalizeString(row['Тестировщик'] || '');
    const waveRaw = row['№ волны'];
    const waveStr = String(waveRaw ?? '').trim().toLowerCase();
    const isWave1 = waveStr === 'волна 1';
    const isWave2 = waveStr === 'волна 2';

    if (tester.includes(normalizedFio) && (isWave1 || isWave2)) {
      const waveNumber = isWave1 ? '1' : '2';
      results.push({
        id: row['ID'] || row['Id'] || row['id'] || '',
        partner: row['Партнер'] || '',
        restaurant: row['Ресторан'] || '',
        address: row['Адрес'] || '',
        city: row['Город'] || '',
        method: row['Способ проверки'] || '',
        wave: waveNumber,
        display: `${row['Партнер'] || ''} → ${row['Ресторан'] || ''} → ${row['Адрес'] || ''} → ${row['Способ проверки'] || ''}`
      });
    }
  });

  return results;
}

async function findText(partner, method) {
  // Сначала пробуем найти в новой JSON структуре
  if (!restaurantTexts) {
    await loadRestaurantTexts();
  }
  
  if (restaurantTexts && restaurantTexts.specific_texts) {
    const np = normalizeString(partner);
    const nm = normalizeString(method);
    
    // Ищем точное совпадение в JSON
    for (const [key, textData] of Object.entries(restaurantTexts.specific_texts)) {
      if (normalizeString(textData.partner) === np && normalizeString(textData.method) === nm) {
        return textData;
      }
    }
  }
  
  // Fallback на старую систему Excel если не найдено в JSON
  if (!excelData.тексты) { await loadExcelFile(); }
  if (!excelData.тексты || excelData.тексты.length < 3) return '';
  
  const partnersRow = excelData.тексты[0] || [];
  const methodsRow = excelData.тексты[1] || [];
  const textsRow = excelData.тексты[2] || [];
  const np = normalizeString(partner), nm = normalizeString(method);
  
  for (let i = 1; i < partnersRow.length; i++) {
    if (normalizeString(partnersRow[i]) === np && normalizeString(methodsRow[i]) === nm) {
      return textsRow[i] || '';
    }
  }
  return textsRow[textsRow.length - 1] || '';
}

function renderAddresses(items) {
  if (!items || items.length === 0) {
    $addresses.innerHTML = '<div class="addr">Адреса не найдены для волн 1 и 2</div>';
    $addresses.style.display = 'block';
    $container.classList.add('with-result');
    return;
  }

  const html = items.map(item => {
    const isCompleted = getCompletionStatus(item.partner, item.restaurant, item.method);
    const statusClass = isCompleted ? 'completed' : 'pending';
    
    return `
      <div class="addr ${statusClass}" data-partner="${htmlEscape(item.partner)}" data-method="${htmlEscape(item.method)}" data-restaurant="${htmlEscape(item.restaurant)}" data-address="${htmlEscape(item.address)}" data-city="${htmlEscape(item.city)}">
        <div class="addr-header"><strong>${htmlEscape(item.partner)}</strong> — ${htmlEscape(item.restaurant)} <span class="wave-badge">Волна ${item.wave}</span></div>
        <div class="addr-details"><em class="addr-line">${htmlEscape(item.address)}</em><br><span class="method-strong">${htmlEscape(item.method)}</span></div>
        <div class="completion-toggle" title="${isCompleted ? 'Отменить выполнение' : 'Отметить как выполненное'}"></div>
      </div>
    `;
  }).join('');

  $addresses.innerHTML = html;
  $addresses.style.display = 'block';
  $container.classList.add('with-result');

  document.querySelectorAll('.addr').forEach(node => {
    const partner = node.dataset.partner;
    const method = node.dataset.method;
    const restaurant = node.dataset.restaurant || '';
    const address = node.dataset.address || '';
    const city = node.dataset.city || '';

    // Обработчик клика на основную область (открытие инструкций)
    node.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('completion-toggle')) {
        await onPick({ partner, method, restaurant, address, city });
      }
    });

    // Обработчик клика на кнопку переключения состояния
    const toggleBtn = node.querySelector('.completion-toggle');
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newStatus = toggleCompletion(partner, restaurant, method);
      
      if (newStatus) {
        node.classList.remove('pending');
        node.classList.add('completed');
        toggleBtn.title = 'Отменить выполнение';
        showStatus(`Ресторан "${restaurant}" отмечен как выполненный`, false);
      } else {
        node.classList.remove('completed');
        node.classList.add('pending');
        toggleBtn.title = 'Отметить как выполненное';
        showStatus(`Отметка выполнения снята с "${restaurant}"`, false);
      }
    });
  });
}


function formatText(textData, item) {
  if (typeof textData === 'string') {
    // Старый формат из Excel
    const cleaned = (textData || '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return cleaned.replace(/\n/g, '<br>');
  }
  
  if (!textData || typeof textData !== 'object') {
    return 'Инструкция не найдена для данной комбинации партнера и способа проверки.';
  }
  
  // Новый формат из JSON
  let generalTemplate = '';
  if (restaurantTexts && restaurantTexts.templates && restaurantTexts.templates.general) {
    generalTemplate = restaurantTexts.templates.general.content;
  }
  
  function getDeliveryService(item) {
    if (!excelData.доставки || excelData.доставки.length === 0) return '';
    const nid = (item.id || '').toString().trim();
    const np = normalizeString(item.partner);
    const nr = normalizeString(item.restaurant);
    const na = normalizeString(item.address);
    // 1) по ID
    if (nid) {
      const row = excelData.доставки.find(r => (r['ID'] || r['Id'] || r['id'] || '').toString().trim() === nid);
      if (row && row['Сервис для оформления доставки']) return String(row['Сервис для оформления доставки']).trim();
    }
    // 2) по партнеру + адресу (+ ресторан)
    const found = excelData.доставки.find(r => {
      const rp = normalizeString(r['Партнер'] || '');
      const rr = normalizeString(r['Ресторан'] || '');
      const ra = normalizeString(r['Адрес'] || '');
      return rp === np && (ra === na || rr === nr);
    });
    return found ? String(found['Сервис для оформления доставки'] || '').trim() : '';
  }
  
  // Сначала заменяем плейсхолдеры в специфичном тексте
  let specificContent = (textData.content || '')
    .replace(/&lt;Название&gt;/g, item.restaurant)
    .replace(/&lt;Адрес&gt;/g, item.address)
    .replace(/&lt;Способ проверки&gt;/g, item.method)
    .replace(/&lt;Сервис для оформления доставки&gt;/g, (() => {
      const url = getDeliveryService(item);
      return url ? url : 'сервис доставки (ссылка не найдена)';
    })());
  
  // Теперь заменяем плейсхолдеры в общем шаблоне
  let result = generalTemplate
    .replace(/&lt;ФИО&gt;/g, $fio.value)
    .replace(/&lt;Название&gt;/g, item.restaurant)
    .replace(/&lt;Адрес&gt;/g, item.address)
    .replace(/&lt;Способ проверки&gt;/g, item.method)
    .replace(/{SPECIFIC_TEXT}/g, specificContent);
  
  // Делаем ссылки кликабельными
  result = makeLinksClickable(result);

  // Сохраняем переносы строк как в тексте (минимальная нормализация)
  result = result
    .replace(/\r\n/g, '\n');

  const hasHtml = /<\/?[a-z][\s\S]*?>/i.test(result);
  return hasHtml ? result : result.replace(/\n/g, '<br>');
}

function makeLinksClickable(text) {
  // Регулярное выражение для поиска URL
  const urlRegex = /(https?:\/\/[^\s<>"]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function initCollapsibles(root) {
  if (!root) return;
  const blocks = root.querySelectorAll('.collapsible');
  blocks.forEach(block => {
    const header = block.querySelector('.collapsible-header');
    if (!header) return;
    // избегаем двойной подписки
    if (header.dataset.bound === '1') return;
    header.dataset.bound = '1';
    header.addEventListener('click', () => {
      block.classList.toggle('active');
    });
  });
}


async function onPick(item) {
  let details = document.getElementById('details');
  if (!details) {
    details = document.createElement('div');
    details.id = 'details';
    details.className = 'details';
    details.innerHTML = '<div class="tester"></div><div class="place"></div><div class="text"></div>';
    $container.appendChild(details);
  }
  
  const textData = await findText(item.partner, item.method);
  details.style.display = 'block';
  details.querySelector('.tester').innerHTML = `Тестировщик: <strong>${htmlEscape($fio.value)}</strong>`;
  details.querySelector('.place').innerHTML = `
    <div><strong>${htmlEscape(item.partner)}</strong> — ${htmlEscape(item.restaurant)}</div>
    <div><em class="addr-line">${htmlEscape(item.address)}</em></div>
    <div><span class="method-strong">${htmlEscape(item.method)}</span></div>
  `;
  
  const formattedText = formatText(textData, item);
  details.querySelector('.text').innerHTML = formattedText;
  initCollapsibles(details.querySelector('.text'));
  
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function performSearch() {
  const fio = $fio.value.trim();
  if (!fio) { showStatus('Введите ФИО', true); $fio.focus(); return; }
  const orig = showLoading($btn, 'Поиск адресов...');
  try {
    const items = await findAssignments(fio);
    renderAddresses(items);
    const details = document.getElementById('details');
    if (details) details.style.display = 'none';
  } catch (e) {
    console.error(e); showStatus('Ошибка поиска', true);
  } finally { hideLoading($btn, orig); }
}


document.addEventListener('DOMContentLoaded', async () => {
  $fio.focus();
  $btn.addEventListener('click', performSearch);
  $fio.addEventListener('keypress', e => { if (e.key === 'Enter') performSearch(); });
  await loadExcelFile();
});


