/**
 * Keeps an option visible inside its own scroll area. Only that area scrolls: `scrollIntoView` can also scroll the
 * page behind a sheet, so it is not used.
 */
export function revealInside(container: HTMLElement, el: HTMLElement, center = false) {
  const top = el.offsetTop;
  const bottom = top + el.offsetHeight;
  if (center) {
    container.scrollTop = top - (container.clientHeight - el.offsetHeight) / 2;
  } else if (top < container.scrollTop) {
    container.scrollTop = top;
  } else if (bottom > container.scrollTop + container.clientHeight) {
    container.scrollTop = bottom - container.clientHeight;
  }
}
