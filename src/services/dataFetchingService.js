class DataFetchingService {
    constructor(firestore) {
        this.firestore = firestore;
    }

    async getProgressData() {
        const progressData = []; 

        const progressSnapshot = await this.firestore
            .collection('achievements')
            .get();

        progressSnapshot.forEach(doc => {
            const data = doc.data();
            const seriesProgress = data.series_progress; 
            progressData.push(seriesProgress);
        });

        return progressData;
    }
}


module.exports = {
    DataFetchingService
};