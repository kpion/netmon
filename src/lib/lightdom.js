/*
LightDom 2.1 

Lightweight querySelectorAll wrapper and DOM manipulation clas, inheriting from the Array class.

https://github.com/kpion/lightdom

*/

(function (window) {
 
    class LightDom extends Array{

        constructor(parameter = null, context = null) {
            super();
            this.context = context || document;
            this.add(parameter,context);
        }

        //internal use only
        add(parameter, context = null){
            let nodes = null;//used only if adding from array / other LightDom instance
            if (typeof parameter === 'string' && parameter !== '') {
                //Object.assign(this, Array.from(this.context.querySelectorAll(parameter)));
                parameter = parameter.trim();
                if (parameter[0] === '<') {//(string)html
                    nodes = Array.from(this.create(parameter));
                }else{                
                    nodes = Array.from(this.context.querySelectorAll(parameter));
                }
            } else if (parameter instanceof Node) {//includes HTMLElement, Element, Node etc
                this.push (parameter);
            } else if (parameter instanceof NodeList || parameter instanceof HTMLCollection || parameter instanceof Array) {
                //Object.assign(this, Array.from(parameter));
                nodes = Array.from(parameter);
            } else if (parameter instanceof LightDom) {
                //copying ourselves to ourselves
                //Object.assign(this, parameter);
                nodes = parameter;
            } else if (typeof parameter === 'function') {
                //callback to call when document is ready (DOMContentLoaded or immediately if already loaded)
                this.ready(parameter);
            } else{
                //acceptable in certain situations only, like calling e.g. l().setLogging(false);
            }
            if(nodes){//only if adding from array / other LightDom instance
                if(this.length === 0){
                    Object.assign(this, nodes);
                }else{
                    nodes.forEach(el => this.push(el));
                }
            }
            return this;
        }

        //`each` which wraps every single element in LightDom
        each(callback){
            this.forEach(node => callback(new LightDom(node)));
            return this;
        }

        //our version, only difference is that we return "this".
        forEach(callback){
            super.forEach(callback);
            return this;
        }



        filter(parameter = null){
            if(typeof parameter === 'string'){
                return new LightDom(super.filter(el => el.matches(parameter)));
            }
            if(parameter === null){
                return new LightDom(this);
            }
            //must be a function:
            return new LightDom(super.filter(parameter));
            
        }

        //only for those who expect this method here. Because we are just an array.
        get(index){
            if(typeof index === 'undefined'){//this is what jquery does too.
                return this;
            }
            return this[index];
        }

        // Find all the nodes CHILDREN of the current ones, matched by a selector
        find (parameter) {
           let result = new LightDom();
           this.forEach(node => {
               result.add(node.querySelectorAll(parameter))
           })
           return result;
        };

        //Get (unique) parents of all nodes.
        parent () {
            let result = new LightDom();
            this.forEach(node => {
                if(!result.includes (node.parentNode)){
                   result.add(node.parentNode)
                }
            })
            return result;
        };

        // Get the closest (by selector) parents of all nodes
        closest (parameter) {
            let result = new LightDom();
            this.forEach(node => {
                while((node = node.parentNode) && (node !== document)){
                    if(node.matches (parameter) && !result.includes (node)){
                        result.add(node);
                        break;
                    }
                }
            })
            return result;
        };

        is(parameter){
            return this.some(node => node.matches(parameter));
        }

        css(property,val = null){
            if(val === null && typeof property !== 'object'){//reading
                return this[0] ? this[0].style[property] : null;
            }
            //setting:
            const properties = (typeof property == 'object')?property:{[property]: val};
            return this.forEach(node => {
                Object.assign(node.style,properties);
            })
        }

        attr(property,val = null){
            if(val === null && typeof property !== 'object'){//reading
                return this[0] ? this[0].getAttribute(property) : null;
            }
            //setting:
            const properties = (typeof property == 'object')?property:{[property]: val};
            return this.forEach(node => {
                Object.entries(properties).forEach( ([prop,val]) => {node.setAttribute (prop,val)})
            })
        }       
        
        addClass(name){
            return this.forEach(node => {
                node.classList.add (name);
            })            
        }

        removeClass(name){
            return this.forEach(node => {
                node.classList.remove (name);
            })            
        }

        toggleClass(name){
            return this.forEach(node => {
                node.classList.toggle (name);
            })            
        }        

        html(val = null){
            if(val === null){
                return this[0] ? this[0].innerHTML : '';
            }
            return this.forEach(node => {
                node.innerHTML = val;
            })            
        }

        empty(){
            return this.html('');
        }

        text(val = null){
            if(val === null){
                return this[0] ? this[0].textContent : '';
            }
            return this.forEach(node => {
                node.textContent = val;
            })            
        }     

        insertAdjacentHTML(position, html){
            return this.forEach(node => {
                node.insertAdjacentHTML (position, html);
            })              
        }
 
        append(param){
            return this._insertElement (param, 'beforeend', 'append');
        }

        //alias for .append
        appendChild(param){
            return this.append(param);
        }

        prepend(param){
            return this._insertElement (param, 'afterbegin', 'prepend');
        }

        before(param){
            return this._insertElement (param, 'beforebegin', 'before');
        } 

        after(param){
            return this._insertElement (param, 'afterend', 'after');
        }        

        //creates and returns new element(s) from (string)html (does not add them here), rather for internal use only
        create(html){
            //we can't use document.createDocumentFragment(); because it doesn't have .innerHTML
            var div = document.createElement('div');
            div.innerHTML = html;
            return new LightDom (div.childNodes);
        }

        on(type, callback, options = false){
            return this.forEach(node => {
                node.addEventListener(type, callback, options);
           });
        }
        
        //this one will just work on a document regardless of nodes in our collection
        ready(callback){
            let callbackEvent = ()=>{
                callback();
                document.removeEventListener("DOMContentLoaded",callbackEvent);
            };
            if (document.readyState === "loading") {//might be 'loading' or 'complete'
                document.addEventListener("DOMContentLoaded", callbackEvent);
            
            } else {//dom already loaded, so the above event will never fire, so:  
                callback();
            }
            return this;
        }

         /** 
         * [INTERNAL] A very generic (internal) method. Will insert a string html or an element (node); 
         * Depending on the type of the argument.
         * @param param - whatever (html, node, nodelist, another lightdom etc)
         * @param position - only when param is (string)html -  one of insertAdjacentHTML 'position' values - like 'beforeend' etc
         * @param action - only when param is nodelist, lightdom etc, one of methods like 'append', 'prepend', 'before', 'after'
         */ 
        _insertElement(param, position, action){
            //a (string) HTML
            if(typeof param === 'string'){
                return this.insertAdjacentHTML(position, param);
            }
            //we are going with the .append .prepend etc. 
            let lSrc = param instanceof LightDom ? param : new LightDom(param);
            //if this is just a single Node, for optimization sake we'll just insert it, 
            //we don't need playing with documentFragment for this single Node
            if(lSrc.length === 1){
                return this.forEach(node => {
                    node[action](lSrc[0].cloneNode(true));
                 }) 
            }
            //preparing whole fragment to insert later:
            let fragment = document.createDocumentFragment();
            lSrc.forEach(srcElem => {
                fragment.appendChild(srcElem.cloneNode(true));
            })
            //actual inserting:
            return this.forEach(node => {
               node[action](fragment.cloneNode(true));
            })       
        }      

    }

    /////////
    //End of class LightDom definition

    function lightdom(parameter, context = null) {
        return new LightDom(parameter, context);
    }


    //finally, it will be available under l:
    window.l = lightdom;


})(window);
