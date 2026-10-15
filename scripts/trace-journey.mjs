// Journey helper: inspect visible Trace steps through the same disclosure control a person uses.
export async function expandTrace(browser, selector = '[data-testid=activity]') {
  const activities = `document.querySelectorAll(${JSON.stringify(selector)})`;
  for (let index = 0; index < await browser.evaluate(`${activities}.length`); index++) {
    const activity = `${activities}[${index}]`;
    if (await browser.evaluate(`${activity}.dataset.open === 'false'`)) {
      await browser.evaluate(`${activity}.querySelector('[data-slot=trace-collapsible-trigger]').focus()`);
      await browser.press('Enter');
      await browser.until('Trace summary expanded', `${activity}.dataset.open === 'true'`, 5000);
    }
  }
}
