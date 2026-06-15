document.addEventListener('click', function (event) {
var link = event.target.closest('a[data-ws]')
if (!link) return
event.preventDefault()
parent.postMessage({ source: 'seneca-landing', action: link.getAttribute('data-ws') }, '*')
})
