
/**
 * html <table> service. We're not using any wrapper for dom modification to make everything as fast
 * as possible.
 */
class Table{
  
    constructor(tableElement, columns){
        this.tableEl = tableElement;
        this.tableHeadEl = document.querySelector('thead',tableElement);
        this.tableBodyEl = document.querySelector('tbody',tableElement);
        this.setColumns(columns);
        
        
        //autoscrolling 
        this.autoScrollEnabled = true;
        this.autoScrollJustDone = false;
        this.tableBodyEl.addEventListener('scroll',(ev)=>{
        //did *user* do the scroll? If so, then maybe we will enable / disable autoscroll.
        if(!this.autoScrollJustDone){
            //did he/she scroll to the bottom? If not, then we'll disable autoscroll
            this.autoScrollEnabled = (this.tableBodyEl.scrollTop === this.tableBodyEl.scrollHeight - this.tableBodyEl.clientHeight);
        }
        this.autoScrollJustDone = false;
        })
        
        //adjusting styles (widths mainly)
        setInterval(()=>{
            this.adjustStyles();
        },100)
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
            utils.removeChildren(this.tableHeadEl);
        }
        if(removeBody){
            utils.removeChildren(this.tableBodyEl);
        }        
    }

    make (entries = null){
        if(!this.tableEl){
            console.error('tableEl is empty');return;
        }
        const head = this.makeHead();
        this.tableHeadEl.appendChild(head);
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
            th.classList.add('col-' + column[3]);
        }
        tr.appendChild(th);  
      }
      fragment.appendChild(tr);
      return fragment;
    }

    makeRow(entry){
        const tr = document.createElement('tr');
        tr.setAttribute('data-requestKey',getKey(entry.request));
        const _td = document.createElement('td');   
        const _span = document.createElement('span');
        const url = new URL(entry.request.url);
        let trClass = [];//might be something in case of statusCode == 404 etc.
        //console.log(entry,JSON.stringify(entry,null,' '));
        for (var colIndex in this.columns){ 
            //whole line like ['Type','request','type','type']
            //or ['Domain','special','host','url-domain']:
            const column = this.columns[colIndex];
            const td = _td.cloneNode(false);
            const span = _span.cloneNode(false);

            let tdText = '';
            let tdClass = [];
            let tdStyle = '';//this one is used only when coloring 'tab info' cell
            let tdTitle = '';
            if(column[3]){//css class
                tdClass.push('col-' + column[3]);
            }              
            if(column[1] === 'special'){//we must handle this manually
                if(column[2] === 'showDetails'){
                    tdText = '𝄙';
                    tdClass.push ('showDetails');
                }
                if(column[2] === 'host'){
                    tdText = url.host;
                    tdTitle = entry.request.url;
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

                if(column[2] === 'tabTitle'){
                    //title isn't guaranteed to contain anything. It's only there when domdocument is fully
                    //loaded.
                    tdText = entry.extra.tab.title ? entry.extra.tab.title : entry.extra.tab.url;
                    tdTitle = entry.extra.tab.title + ' (' + entry.extra.tab.url + ')';
                    //border color:
                    const color = utils.distinctColorFromNumber(entry.request.tabId);
                    tdStyle = `border-left:3px solid ${color};`;
                    if(app.isDev()){
                        tdTitle += ` [tabId: ${entry.request.tabId}]`;
                    }
                }
                if(column[2] === 'time'){
                    let totalTime = '';
                    if(entry.extra.time){
                        tdText  = utils.formatTimeSpan(entry.extra.time,0);
                        tdTitle = utils.formatTimeSpan(entry.extra.time,2);     
                    }                    
                }                
                //['Tab','special','tabTitle','slim'],
            }else {//not a 'special' column
                //for starters:
                tdText = entry[column[1]][column[2]];
                if (column[2] === 'type'){
                    if(tdText === 'xmlhttprequest'){
                        tdText = 'xhr';
                    }
                } else if (column[2] === 'statusCode'){
                    if(typeof tdText == 'undefined' || tdText == ''){
                        tdText = 'waiting...';
                        if(entry.response && entry.response.error){
                            tdText = 'error';//initially
                            /*
                            //@todo: just maybe : this one appears when ublock blocks, but only then? 
                            //Besides in FX it's a different message. 
                            if(entry.response.error === 'net::ERR_BLOCKED_BY_CLIENT'){
                                tdText = 'blocked';
                            }*/
                            if(entry.extra.blocked){//this means *we* (the extension) blocked it.
                                tdText = 'blocked';
                            }
                            tdTitle = entry.response.error;//e.g. net::ERR_BLOCKED_BY_CLIENT when blocked by ublock or adblock
                            
                        }
                    }
                }
            }
            if(entry.request && entry.request.type === 'main_frame' && entry.request.frameId == 0){
                trClass.push('item-main-frame');
            }
            //styling tr (e.g. based on statusCode, this doesn't depend on columns being displayed) 
            if(entry.response){
                //it is possible that even when 'response' is there, the statusCode is not. This happens
                //when there is response.error (handled further below)
                if(entry.response.statusCode){
                    const statusCodeInt = parseInt(entry.response.statusCode);  
                    if(entry.response.isRedirect){
                        //Redirection
                        //Check this condition first because redirect with response status 200 can happen if
                        //another extension redirect the request.
                        trClass.push('item-http-redirect');
                    }else if(statusCodeInt >= 200 && statusCodeInt <= 299){
                        //OK
                    }else if (statusCodeInt >= 400){
                        //Error
                        trClass.push('item-server-error');
                    }   
                }
                if(entry.response.error){
                    //client (e.g. via some ad blocker) blocked or something else
                    trClass.push('item-client-error');
                }
            }

            //ok, lets build it.
            span.textContent = tdText;
            if(tdClass.length > 0){
                td.classList.add(...tdClass);
            }
            if(tdStyle != ''){
                td.style.cssText = tdStyle;
            }
            if(tdTitle){
                td.setAttribute('title',tdTitle);
            }
            
            td.appendChild(span);
            tr.appendChild(td);  
          }   

        if(trClass.length > 0){
            tr.classList.add(...trClass);  
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
        this.tableBodyEl.appendChild(tr);
        if(this.autoScrollEnabled){
            this.scrollToBottom();
        }
    }

    addRows(entries){
        const rows = this.makeRows(entries);
        this.tableBodyEl.appendChild(rows);
        if(this.autoScrollEnabled){
            this.scrollToBottom();
        }        
    }

    findRow (entry){
        return document.querySelector('tr[data-requestkey="'+getKey(entry.request)+'"]',this.tableEl);
    }

    /**
     * updates info in a row, by entry
     */ 
    updateRow(entry){
        const trEl = this.findRow(entry);
        if(!trEl){
            return null;
        }
        trEl.replaceWith(this.makeRow(entry));
        return trEl;
    }
    scrollToBottom(){
        this.autoScrollJustDone = true;
        this.tableBodyEl.scrollTop = this.tableBodyEl.scrollHeight - this.tableBodyEl.clientHeight;
        
    }
    adjustStyles(){
        const headWidth = this.tableHeadEl.clientWidth;
        const bodyWidth = this.tableBodyEl.clientWidth;
        if(headWidth !== bodyWidth){
            this.tableHeadEl.style.width = bodyWidth + 'px';  
            //console.log('changed to ' + bodyWidth + 'px')
        }
        //head.style.width = body.clientWidth + 'px';
    }
  }
  