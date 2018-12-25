function elemSelector(t, c, i) {
  var elem = "", selected;
  if (document.querySelector) {
    if (typeof t !== "undefined" && t !== "") {
      elem += t;
    }
    if (typeof c !== "undefined" && c !== "") {
      elem += '.';
      elem += c;
    }
    if (typeof i !== "undefined" && i !== "") {
      elem += "#";
      elem += i;
    }
    selected = document.querySelectorAll(elem);
  } else {
    selected = document;
    if (typeof t !== "undefined") {
      selected = selected.getElementsByTagName(t);
    }
    if (typeof c !== "undefined") {
      selected = selected.getElementsByClassName(c);
    }
    if (typeof i !== "undefined") {
      selected = selected.getElementById(i);
    }
  }
  return selected;
}

function elemSelectorSingle(t, c, i) {
  var selected = elemSelector(t, c, i)[0];
  return selected;
}

function getCSS(elem, property) {
  var css = null;
  if (elem.currentStyle) {
    css = elem.currentStyle[property];
  } else if (window.getComputedStyle) {
    css = document.defaultView.getComputedStyle(elem, null).getPropertyValue(property);
  }
  return css;
}

function getTransform(elem, property) {
  var matrix, values, a, b, c, d, translateX, translateY, scale, rotate;
  matrix = getCSS(elem, 'transform');
  values = matrix.split('(')[1];
  values = values.split(')')[0];
  values = values.split(', ');
  a = values[0];
  b = values[1];
  c = values[2];
  d = values[3];
  translateX = values[4];
  translateY = values[5];
  
  scale = Math.sqrt(a * a + b * b);

  // arc sin, convert from radians to degrees, round
  rotate = Math.round(Math.atan2(b, a) * (180 / Math.PI));
  
  return eval(property);
}

function nav() {
  var mdNavDrawer = elemSelectorSingle("", "md-nav-drawer", ""), navLayout = elemSelectorSingle("", "md-layout", "");
  if (getTransform(mdNavDrawer, 'translateX') === '0') {
    navLayout.className = navLayout.className.replace(/(?:^|\s)navd-visible(?!\S)/g, '');
    navLayout.className += " navd-invisible";
  } else {
    navLayout.className += " navd-visible";
    navLayout.className = navLayout.className.replace(/(?:^|\s)navd-invisible(?!\S)/g, '');
  }
}

window.onload = function () {
  var i, navSwitch, navSwitches = elemSelector("", "md-nav-switch", ""), navLayout = elemSelectorSingle("", "md-layout", ""), scrim = document.createElement('div');
  scrim.onclick = function () {
    nav();
  };
  scrim.className = "scrim";
  navLayout.insertBefore(scrim, navLayout.firstChild);
  for (i = 0; i < navSwitches.length; i++) {
    navSwitch = navSwitches[i];
    navSwitch.onclick = function () {
      nav();
    };
  }
};
