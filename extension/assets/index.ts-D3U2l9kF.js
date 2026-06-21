(function(){function n(e,c){let t;return()=>{clearTimeout(t),t=setTimeout(e,c)}}const o=n(()=>{chrome.runtime.sendMessage({type:"ACTIVITY"}).catch(()=>{})},1e3),s=["mousemove","keydown","scroll","click","touchstart"];s.forEach(e=>document.addEventListener(e,o,{passive:!0}));o();
})()
