/* =========================================================================
   Glow & Soft — script.js
   Shared across product.html, order.html, admin.html.
   Each init function only runs if that page's key element exists.
   ========================================================================= */

const ORDER_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwKlz9FFlwfaBob2tfyXdolF0DOHGJ-c87IHzUGYtdEMiJLIkjhivG3yg5P0KZu872J0Q/exec';
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRlzlcLgR0DGJMYXyLF28sXxUUWL4sgJvdFXVJEV24vJiucLRy_YWxaJMID2IB0B_Xv4f8NsyPwC5Qz/pub?gid=0&single=true&output=csv';

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('product-list')) initProductPage();
  if (document.getElementById('orderForm')) initOrderPage();
  if (document.querySelector('#ordersTable tbody')) initAdminPage();
});

/* =========================================================================
   1) product.html — load products.json, render cards, filter by mood
   ========================================================================= */
function initProductPage() {
  const listEl = document.getElementById('product-list');
  const filterBar = document.getElementById('filter-bar');

  fetch('products.json')
    .then((res) => res.json())
    .then((products) => {
      const urlMood = new URLSearchParams(window.location.search).get('mood');
      const initialMood = urlMood ? urlMood.toLowerCase() : 'all';

      renderProducts(listEl, products, initialMood);
      setActiveFilterButton(filterBar, initialMood);

      if (filterBar) {
        filterBar.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-mood]');
          if (!btn) return;

          const mood = btn.dataset.mood.toLowerCase();
          renderProducts(listEl, products, mood);
          setActiveFilterButton(filterBar, mood);

          const url = new URL(window.location.href);
          if (mood === 'all') {
            url.searchParams.delete('mood');
          } else {
            url.searchParams.set('mood', mood);
          }
          window.history.replaceState({}, '', url);
        });
      }
    })
    .catch((error) => {
      console.error(error);
      if (listEl) {
        listEl.innerHTML = '<p class="text-soft">ไม่สามารถโหลดรายการสินค้าได้ในขณะนี้</p>';
      }
    });
}

function renderProducts(listEl, products, mood) {
  if (!listEl) return;

  const filtered = mood && mood !== 'all'
    ? products.filter((p) => p.mood.toLowerCase() === mood)
    : products;

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="text-soft">ไม่พบสินค้าในหมวดนี้</p>';
    return;
  }

  listEl.innerHTML = filtered.map(productCardHTML).join('');
}

function productCardHTML(product) {
  const orderUrl = `order.html?item=${encodeURIComponent(product.name + ' ' + product.size)}&price=${encodeURIComponent(product.price)}`;

  return `
    <article class="product-card" data-mood="${escapeHTML(product.mood)}">
      <div class="product-card__image">
        <img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" loading="lazy">
      </div>
      <span class="mood-rule mood-rule--${escapeHTML(product.mood)}"></span>
      <h3 class="product-card__name">${escapeHTML(product.name)}</h3>
      <p class="product-card__meta">${escapeHTML(product.size)}</p>
      <div class="product-card__footer">
        <span class="product-card__price">${Number(product.price).toLocaleString('th-TH')} บาท</span>
        <a class="btn btn--primary" href="${orderUrl}">สั่งซื้อ</a>
      </div>
    </article>
  `;
}

function setActiveFilterButton(filterBar, mood) {
  if (!filterBar) return;
  const buttons = filterBar.querySelectorAll('[data-mood]');
  buttons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mood.toLowerCase() === (mood || 'all'));
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}

/* =========================================================================
   2) order.html — autofill from URL params, submit to Apps Script
   ========================================================================= */
function initOrderPage() {
  const params = new URLSearchParams(window.location.search);
  const itemField = document.getElementById('items');
  const totalField = document.getElementById('total');

  if (itemField && params.has('item')) {
    itemField.value = params.get('item');
  }
  if (totalField && params.has('price')) {
    totalField.value = params.get('price');
  }

  const form = document.getElementById('orderForm');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const payload = {
      customerName: document.getElementById('customerName')?.value ?? '',
      contact: document.getElementById('contact')?.value ?? '',
      items: document.getElementById('items')?.value ?? '',
      total: document.getElementById('total')?.value ?? '',
      note: document.getElementById('note')?.value ?? '',
    };

    fetch(ORDER_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
      .then(() => {
        window.location.href = 'thankyou.html';
      })
      .catch((error) => {
        console.error(error);
        alert('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
      });
  });
}

/* =========================================================================
   3) admin.html — fetch published CSV, parse manually, render table
   ========================================================================= */
function initAdminPage() {
  const tbody = document.querySelector('#ordersTable tbody');
  if (!tbody) return;

  fetch(SHEET_CSV_URL)
    .then((res) => res.text())
    .then((csvText) => {
      const rows = parseCSV(csvText);
      if (rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6">ยังไม่มีรายการสั่งซื้อ</td></tr>';
        return;
      }

      // First row is assumed to be the header — drop it.
      const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim() !== ''));

      const sorted = sortRowsByDateDesc(dataRows);
      tbody.innerHTML = sorted.map(orderRowHTML).join('');
    })
    .catch((error) => {
      console.error(error);
      tbody.innerHTML = '<tr><td colspan="6">ไม่สามารถโหลดข้อมูลได้ในขณะนี้</td></tr>';
    });
}

/**
 * Minimal RFC4180-style CSV parser (no external library).
 * Handles quoted fields, escaped quotes (""), commas and newlines inside quotes.
 * Returns an array of rows, each row an array of string cells.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Normalize line endings so \r\n inside quoted fields doesn't confuse us.
  const input = text.replace(/\r\n/g, '\n');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  // Push the last field/row if the file doesn't end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function sortRowsByDateDesc(rows) {
  const withParsedDate = rows.map((row, index) => ({
    row,
    index,
    time: parseThaiOrDefaultDate(row[0]),
  }));

  const allDatesValid = withParsedDate.every((r) => !Number.isNaN(r.time));

  if (allDatesValid) {
    withParsedDate.sort((a, b) => b.time - a.time);
  } else {
    // Fallback: assume rows were appended oldest-first, so reverse order.
    withParsedDate.sort((a, b) => b.index - a.index);
  }

  return withParsedDate.map((r) => r.row);
}

function parseThaiOrDefaultDate(dateStr) {
  if (!dateStr) return NaN;
  const parsed = new Date(dateStr);
  return parsed.getTime();
}

function orderRowHTML(row) {
  const [timestamp = '', customerName = '', contact = '', items = '', total = '', note = ''] = row;

  return `
    <tr>
      <td>${escapeHTML(timestamp)}</td>
      <td>${escapeHTML(customerName)}</td>
      <td>${escapeHTML(contact)}</td>
      <td>${escapeHTML(items)}</td>
      <td>${escapeHTML(total)}</td>
      <td>${escapeHTML(note)}</td>
    </tr>
  `;
}
