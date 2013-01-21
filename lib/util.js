String.prototype.isUpperCase = function () {
    return this == this.toUpperCase().toArray().join('');
};

Array.prototype.contains = function (item) {
    return this.indexOf(item) !== -1;
};

Object.prototype.toArray = function () {
    var arr = [];
    for (var i in this) {
        if (this.hasOwnProperty(i)) {
            arr.push(this[i]);
        }
    }
    return arr;
};
