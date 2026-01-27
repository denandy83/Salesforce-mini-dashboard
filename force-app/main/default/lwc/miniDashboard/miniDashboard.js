import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { getObjectInfo } from 'lightning/uiObjectInfoApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import CASE_OBJECT from '@salesforce/schema/Case';
import CASE_ACCOUNT_ID from '@salesforce/schema/Case.AccountId';
import CONTACT_ACCOUNT_ID from '@salesforce/schema/Contact.AccountId';
import { EnclosingTabId, openTab, onTabFocused } from 'lightning/platformWorkspaceApi';
import getDashboardData from '@salesforce/apex/MiniDashboardController.getDashboardData';
import getCaseList from '@salesforce/apex/MiniDashboardController.getCaseList';

const FIELDS_MAP = {
    Contact: [CONTACT_ACCOUNT_ID, 'Contact.Account.AVB_ICAO_Account__c'],
    Case: [CASE_ACCOUNT_ID, 'Case.AVB_ICAO_Account__c'],
    Account: ['Account.Id', 'Account.AVB_ICAO_Account__c']
};

const DEFAULT_COLUMNS = 'Subject, Priority, CreatedDate';
const DOT_SEP = '__DOT__';

export default class MiniDashboard extends NavigationMixin(LightningElement) {
    @api recordId;
    @api objectApiName;

    @api newThreshold = 5;
    @api openThreshold = 10;
    @api waitingThreshold = 5;
    @api holdThreshold = 5;
    
    @api columnFields = DEFAULT_COLUMNS;
    @api extraExportFields = '';
    @api defaultSortField = 'CreatedDate';
    @api defaultSortDirection = 'desc';
    @api pollingFrequency = 60;

    @api thresholdColor = '#ff0000';
    @api normalColor = '#000000';

    @track totalItems = this.initItems();
    @track myItems = this.initItems();
    @track accountItems = this.initItems();

    @track isModalOpen = false;
    @track isExportModalOpen = false;
    @track modalTitle = '';
    @track modalData = [];
    @track columns = [];
    @track selectableFields = [];
    
    @track sortedBy = 'CreatedDate';
    @track sortedDirection = 'desc';
    @track searchTerm = '';
    @track priorityFilter = '';
    
    isLoadingModal = false;
    isMoreDataAvailable = true;
    offset = 0;
    limit = 20;

    @wire(EnclosingTabId) enclosingTabId;
    @wire(getObjectInfo, { objectApiName: CASE_OBJECT }) caseInfo;

    accountId;
    icaoValue;
    pollingInterval;
    currentDashboardId;
    currentAccountId;
    currentOnlyMine = false;

    initItems() {
        return [
            { id: 'New', fullLabel: 'New', count: 0, tooltip: '', barColor: '#81C784' },
            { id: 'Open', fullLabel: 'Open', count: 0, tooltip: '', barColor: '#E57373' },
            { id: 'Waiting for Customer', fullLabel: 'Waiting', count: 0, tooltip: '', barColor: '#64B5F6' },
            { id: 'On Hold', fullLabel: 'Hold', count: 0, tooltip: '', barColor: '#90A4AE' }
        ];
    }

    @wire(getRecord, { recordId: '$recordId', fields: '$currentFields' })
    wiredRecord({ error, data }) {
        if (data) {
            if (this.objectApiName === 'Account') { this.accountId = this.recordId; this.icaoValue = getFieldValue(data, 'Account.AVB_ICAO_Account__c'); } 
            else if (this.objectApiName === 'Contact') { this.accountId = getFieldValue(data, CONTACT_ACCOUNT_ID); this.icaoValue = getFieldValue(data, 'Contact.Account.AVB_ICAO_Account__c'); } 
            else if (this.objectApiName === 'Case') { this.accountId = getFieldValue(data, CASE_ACCOUNT_ID); this.icaoValue = getFieldValue(data, 'Case.AVB_ICAO_Account__c'); }
            this.fetchData();
        }
    }

    get currentFields() { return FIELDS_MAP[this.objectApiName] || []; }
    get showAccountRow() { return !!this.accountId; }
    get accountRowLabel() { return this.icaoValue ? this.icaoValue : 'Account'; }
    get hasNoModalResults() { return !this.isLoadingModal && this.modalData.length === 0; }
    get priorityFilterUrgent() { return this.priorityFilter === 'Urgent' ? 'brand' : 'neutral'; }
    get priorityFilterHigh() { return this.priorityFilter === 'High' ? 'brand' : 'neutral'; }
    get priorityFilterNormal() { return this.priorityFilter === 'Normal' ? 'brand' : 'neutral'; }
    get priorityFilterLow() { return this.priorityFilter === 'Low' ? 'brand' : 'neutral'; }
    get hasJiraBtnVariant() { return this.hasJiraFilter ? 'brand' : 'neutral'; }

    connectedCallback() {
        this.startPolling();
        if (onTabFocused) { onTabFocused((event) => { if (event.tabId === this.enclosingTabId?.data) { this.fetchData(); this.startPolling(); } else { this.stopPolling(); } }); }
    }

    startPolling() { this.stopPolling(); this.pollingInterval = setInterval(() => { this.fetchData(); }, (this.pollingFrequency || 60) * 1000); }
    stopPolling() { if (this.pollingInterval) clearInterval(this.pollingInterval); }

    fetchData() {
        getDashboardData({ accountId: this.accountId })
            .then(result => {
                this.totalItems = this.processItems(this.totalItems, result.totals);
                this.myItems = this.processItems(this.myItems, result.myTickets);
                if (result.accountSpecific) this.accountItems = this.processItems(this.accountItems, result.accountSpecific);
            })
            .catch(error => console.error(error));
    }

    processItems(items, data) {
        return items.map(item => {
            const summary = data[item.id] || { count: 0, priorityTooltip: '', priorityMap: {} };
            let threshold = 0;
            if (item.id === 'New') threshold = this.newThreshold;
            else if (item.id === 'Open') threshold = this.openThreshold;
            else if (item.id === 'Waiting for Customer') threshold = this.waitingThreshold;
            else if (item.id === 'On Hold') threshold = this.holdThreshold;
            const isOverThreshold = summary.count > threshold;
            const color = isOverThreshold ? this.thresholdColor : this.normalColor;
            let bgColor = 'transparent';
            if (summary.count > 0) {
                if (summary.priorityMap['Urgent'] > 0) bgColor = 'rgba(229, 115, 115, 0.15)'; 
                else if (summary.priorityMap['High'] > 0) bgColor = 'rgba(255, 183, 77, 0.2)';  
                else bgColor = 'rgba(129, 199, 132, 0.15)'; 
            }
            return { ...item, count: summary.count, tooltip: summary.priorityTooltip, barStyle: `background-color: ${item.barColor}`, itemStyle: `color: ${color}`, heatmapStyle: `background-color: ${bgColor}` };
        });
    }

    handleItemClick(event) {
        this.currentDashboardId = event.currentTarget.dataset.id;
        this.currentAccountId = event.currentTarget.dataset.scope === 'account' ? this.accountId : null;
        this.currentOnlyMine = event.currentTarget.dataset.scope === 'my';
        this.modalData = []; this.offset = 0; this.isModalOpen = true;
        this.buildColumns(); this.loadModalData();
    }

    buildColumns() {
        const fieldList = this.columnFields.split(',').map(f => f.trim());
        const cols = [{ label: 'Case Number', fieldName: 'CaseNumber', type: 'button', style: 'width: 100px; min-width: 100px; max-width: 100px;' }];
        
        fieldList.forEach(f => {
            if (f.toLowerCase() === 'casenumber') return;
            const parts = f.split(':');
            const rawField = parts[0].trim();
            const width = parts.length > 1 ? parts[1].trim() : null;

            let fieldName = rawField;
            let label = rawField;
            let type = 'text';

            if (rawField.includes('.')) {
                fieldName = rawField.replaceAll('.', DOT_SEP);
                label = rawField.split('.')[0] + ' ' + rawField.split('.')[1];
            } else if (this.caseInfo?.data?.fields[rawField]) {
                label = this.caseInfo.data.fields[rawField].label;
                if (rawField.toLowerCase().includes('date')) type = 'date';
            }

            const style = width ? `width: ${width}px; min-width: ${width}px;` : '';
            cols.push({ 
                label: label, 
                fieldName: fieldName, 
                type: type,
                style: style,
                headerClass: fieldName === this.sortedBy ? 'is-sorted' : '', 
                showSortIcon: fieldName === this.sortedBy 
            });
        });
        this.columns = cols;
    }

    loadModalData() {
        const cleanFields = this.columnFields.split(',').map(f => f.trim().split(':')[0].trim());
        this.isLoadingModal = true;
        getCaseList({ 
            dashboardId: this.currentDashboardId, accountId: this.currentAccountId, fields: cleanFields,
            sortField: this.sortedBy.replaceAll(DOT_SEP, '.'), sortOrder: this.sortedDirection,
            searchTerm: this.searchTerm, offset: this.offset, onlyMine: this.currentOnlyMine,
            priorityFilter: this.priorityFilter
        })
        .then(data => {
            const flattened = this.flattenData(data).map(c => {
                let rowClass = 'table-row';
                if (c.Priority === 'Urgent') rowClass += ' priority-urgent';
                else if (c.Priority === 'High') rowClass += ' priority-high';
                else if (c.Priority === 'Normal') rowClass += ' priority-normal';
                else if (c.Priority === 'Low') rowClass += ' priority-low';

                const cells = this.columns.map(col => {
                    let val = c[col.fieldName];
                    let jiraLinks = null;
                    if (col.isJira) {
                        jiraLinks = c[col.fieldName + '_list'] || [];
                        val = '';
                    } else if (val && col.fieldName.toLowerCase().includes('date')) {
                        val = this.formatDate(val);
                    }
                    return { key: col.fieldName, value: val, isUrl: col.type === 'button', isJira: col.isJira, jiraLinks: jiraLinks };
                });
                return { ...c, rowClass: rowClass, cells: cells };
            });
            this.modalData = this.offset === 0 ? flattened : [...this.modalData, ...flattened];
            this.isMoreDataAvailable = data.length === this.limit;
        })
        .catch(error => {
            this.handleError('Error loading cases', error);
        })
        .finally(() => { this.isLoadingModal = false; });
    }

    flattenData(data) {
        return data.map(record => {
            let flat = { ...record };
            Object.keys(record).forEach(key => {
                const val = record[key];
                if (val && typeof val === 'object' && !Array.isArray(val)) { Object.keys(val).forEach(k => { flat[`${key}${DOT_SEP}${k}`] = val[k]; }); }
            });
            return flat;
        });
    }

    handleSort(event) {
        const field = event.currentTarget.dataset.id;
        if (this.sortedBy === field) this.sortedDirection = this.sortedDirection === 'asc' ? 'desc' : 'asc';
        else { this.sortedBy = field; this.sortedDirection = 'asc'; }
        this.offset = 0; this.buildColumns(); this.loadModalData();
    }

    handleSearch(event) { this.searchTerm = event.target.value; this.offset = 0; this.loadModalData(); }
    handlePriorityQuickFilter(event) { this.priorityFilter = this.priorityFilter === event.target.value ? '' : event.target.value; this.offset = 0; this.loadModalData(); }
    handleTableScroll(event) { if (event.target.scrollHeight - event.target.scrollTop - event.target.clientHeight < 20 && this.isMoreDataAvailable && !this.isLoadingModal) { this.offset += this.limit; this.loadModalData(); } }
        async viewCase(event) {
            const id = event.currentTarget.dataset.id;
            try { await openTab({ recordId: id, focus: true }); } catch (e) { this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: id, actionName: 'view' } }); }
        }
    
        handleStopPropagation(event) {
            event.stopPropagation();
        }
    
        closeModal() { this.isModalOpen = false; }
    openExportConfig() { this.selectableFields = this.columnFields.split(',').map(f => ({ apiName: f.trim(), label: f.trim(), selected: true })); this.isExportModalOpen = true; }
    closeExportModal() { this.isExportModalOpen = false; }
    handleFieldToggle(event) { this.selectableFields = this.selectableFields.map(f => f.apiName === event.target.dataset.id ? { ...f, selected: event.target.checked } : f); }

    async downloadCSV() {
        const selected = this.selectableFields.filter(f => f.selected).map(f => f.apiName);
        this.closeExportModal();
        try {
            const data = await getCaseList({ dashboardId: this.currentDashboardId, accountId: this.currentAccountId, fields: selected, limitCount: 1000 });
            const flattened = this.flattenData(data);
            let csv = 'Case Number,Link,' + selected.join(',') + '\n';
            flattened.forEach(row => {
                let line = `${row.CaseNumber},${window.location.origin}/lightning/r/Case/${row.Id}/view`;
                selected.forEach(f => { let k = f.includes('.') ? f.replaceAll('.', DOT_SEP) : f; line += ',"'+ String(row[k] || '').replace(/"/g, '""') + '"'; });
                csv += line + '\n';
            });
            const link = document.createElement('a'); link.href = 'data:text/csv;base64,' + window.btoa(unescape(encodeURIComponent(csv)));
            link.download = 'Export.csv'; link.click();
        } catch (e) { this.handleError('Export Failed', e); }
    }

    formatDate(dateStr) {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const pad = (num) => String(num).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    get sortIcon() { return this.sortedDirection === 'asc' ? 'utility:arrowup' : 'utility:arrowdown'; }
    handleError(t, e) { this.dispatchEvent(new ShowToastEvent({ title: t, message: e.body?.message || e.message, variant: 'error' })); }
}
