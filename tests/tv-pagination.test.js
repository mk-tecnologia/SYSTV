import test from 'node:test';
import assert from 'node:assert/strict';
import { TV_MAX_ROWS, TV_PAGE_CAPACITY, balancedPageRanges, productPageIndex, pageProducts } from '../public/tv-pagination.js';

test('balanceia páginas horizontais e verticais sem uma página residual', () => {
  assert.equal(TV_MAX_ROWS,16);
  assert.equal(TV_PAGE_CAPACITY,32);
  for (const [total, capacity, sizes] of [[0,32,[0]], [32,32,[32]], [33,32,[17,16]], [35,32,[18,17]], [64,32,[32,32]], [65,32,[22,22,21]], [69,32,[23,23,23]], [16,16,[16]], [17,16,[9,8]], [33,16,[11,11,11]]]) {
    assert.deepEqual(balancedPageRanges(total,capacity).map(range => range.end-range.start), sizes);
  }
});
test('preserva todos os produtos em ordem, respeita capacidade e encontra a mesma página no editor', () => {
  for (const capacity of [TV_MAX_ROWS,TV_PAGE_CAPACITY]) for (let total=0; total<=300; total++) {
    const products = Array.from({length:total}, (_,index) => ({id:index, highlight:index%2===0}));
    const ranges = balancedPageRanges(total,capacity);
    const pages = ranges.map((_,index) => pageProducts(products,index,capacity));
    const sizes = pages.map(page => page.length);
    assert.deepEqual(pages.flat(),products);
    assert.ok(Math.max(...sizes)<=capacity);
    const columns = capacity / TV_MAX_ROWS;
    assert.ok(sizes.every(size => Math.ceil(size / columns) <= TV_MAX_ROWS));
    assert.ok(Math.max(...sizes)-Math.min(...sizes)<=1);
    assert.equal(pages.length, Math.max(1,Math.ceil(total/capacity)));
    pages.forEach((page,index) => page.forEach(product => assert.equal(productPageIndex(total,product.id,capacity),index)));
  }
});
test('inclusão e exclusão nas fronteiras recalculam a página sem perder o produto selecionado', () => {
  assert.equal(productPageIndex(32,31),0);
  assert.equal(productPageIndex(33,31),1);
  assert.equal(productPageIndex(35,17),0);
  assert.equal(productPageIndex(35,18),1);
  assert.equal(productPageIndex(69,46),2);
  assert.equal(productPageIndex(0,0),0);
  assert.deepEqual(pageProducts([1,2,3],99),[1,2,3]);
  assert.throws(()=>balancedPageRanges(4,0),RangeError);
});
