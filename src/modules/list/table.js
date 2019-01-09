
/**
 * html <table> service. We're not using any wrapper for dom modification to make everything as fast
 * as possible.
 */
class Table{
  
    constructor(tableElement, columns, data){
      this.tableEl = tableElement;
      this.tableTheadEl = document.querySelector('thead',tableElement);
      this.tableTbodyEl = document.querySelector('tbody',tableElement);
      this.setColumns(columns);
      //this.setEntries(data);
      
      this.autoScrollEnabled = true;
      this.autoScrollJustDone = false;
      this.tableTbodyEl.addEventListener('scroll',(ev)=>{
        //did *user* do the scroll? If so, then maybe we will enable / disable autoscroll.
        if(!this.autoScrollJustDone){
            //did he/she scroll to the bottom? If not, then we'll disable autoscroll
            this.autoScrollEnabled = (this.tableTbodyEl.scrollTop === this.tableTbodyEl.scrollHeight - this.tableTbodyEl.clientHeight);
        }
        this.autoScrollJustDone = false;
      })
      
    }

    /*
    @param columns: array of {object,val,display} where object is request or response.
    */
    setColumns(columns){
      this.columns = columns;
    }
    
    /**
     * 
     * @param {Map} entries 
     */
    /*
    setEntries(entries){
      this.entries = entries;
    }
    */

    //remove head and or body
    remove(removeHead = true, removeBody = true){
        if(removeHead){
            utils.removeChildren(this.tableTheadEl);
        }
        if(removeBody){
            utils.removeChildren(this.tableTbodyEl);
        }        
    }

    make (entries = null){
        if(!this.tableEl){
            console.error('tableEl is empty');return;
        }
        const head = this.makeHead();
        //const body = this.makeBody();
        //console.log('head:');console.dir(head.cloneNode(true));//cloneNode because we'll soon move them
        //console.log('body:');console.dir(body.cloneNode(true));//cloneNode because we'll soon move them
        this.tableTheadEl.appendChild(head);
        //this.tableTbodyEl.appendChild(body);

        // if(this.autoScrollEnabled){
        //     this.scrollToBottom();
        // }
        if(entries){
            this.addRows(entries);
        }
    }
    
    makeHead(){
      var fragment = document.createDocumentFragment();
      //var table = document.createElement('table');
      const tr = document.createElement('tr');
      const _th = document.createElement('th');

      //accepting both arrays and objects
      for (var colIndex in this.columns) {
        const column = this.columns[colIndex];
        const th = _th.cloneNode(false);
        

        th.textContent = column[0];//0: display
        if(column[3]){//css class
            th.classList.add(column[3]);
        }
        tr.appendChild(th);  
      }
      fragment.appendChild(tr);
      return fragment;
    }

    makeRow(entry){
        const tr = document.createElement('tr');
        tr.setAttribute('data-requestId',entry.request.requestId);
        const _td = document.createElement('td');   
        const _span = document.createElement('span');
        const url = new URL(entry.request.url);
        //console.log(entry,JSON.stringify(entry,null,' '));
        for (var colIndex in this.columns){ 
            const column = this.columns[colIndex];
            const td = _td.cloneNode(false);
            const span = _span.cloneNode(false);

            let tdText = '';
            let tdClass = '';
            let tdTitle = '';
            if(column[1] === 'special'){//we must handle this manually
                if(column[2] === 'showDetails'){
                    tdText = '𝄙';
                    tdClass = 'showDetails';
                }
                if(column[2] === 'host'){
                    tdText = url.host;
                }
                if(column[2] === 'pathNameSmart'){
                    tdTitle = entry.request.url;
                    const path = url.pathname;              
                    let name = path.substring(path.lastIndexOf("/") + 1, path.length);
                    if(url.search){
                        name += url.search;
                    }
                    tdText = name.length > 0?name : url.host;
                }
            }else if (column[2] === 'type'){
                tdText = entry[column[1]][column[2]];
                if(tdText === 'xmlhttprequest'){
                    tdText = 'xhr';
                }
            } else{
                tdText = entry[column[1]][column[2]];
            }
            /*
            //this actually happened only once, maybe in the future this should be uncommented.
            if(tdText == '' || typeof tdText == 'undefined'){
                
                if(column[2] === 'statusCode' && entry.response.error){//this happened to me once....
                    tdText = entry.response.error;
                }else{
                    tdText = '?';
                }
            }
            */
         
            //td.textContent = tdText;
            span.textContent = tdText;
            if(tdClass){
                td.classList.add(tdClass);
            }
            if(tdTitle){
                td.setAttribute('title',tdTitle);
            }
            if(column[3]){//css class
                td.classList.add(column[3]);
            }              
            td.appendChild(span);
            tr.appendChild(td);  
          }   
        return tr;
    }
    
    makeRows(entries){
        var fragment = document.createDocumentFragment();
        entries.forEach(entry => {
            const tr = this.makeRow(entry);
            fragment.appendChild(tr);
        });
        return fragment;
    }
    
    /*
    use when the table is already built - this one will add a row to existing table.
    */
    addRow(entry){
        const tr = this.makeRow(entry);
        this.tableTbodyEl.appendChild(tr);
        if(this.autoScrollEnabled){
            this.scrollToBottom();
        }
    }

    addRows(entries){
        const rows = this.makeRows(entries);
        this.tableTbodyEl.appendChild(rows);
        if(this.autoScrollEnabled){
            this.scrollToBottom();
        }        
    }
    
    scrollToBottom(){
        this.autoScrollJustDone = true;
        this.tableTbodyEl.scrollTop = this.tableTbodyEl.scrollHeight - this.tableTbodyEl.clientHeight;
        
    }

  }
  