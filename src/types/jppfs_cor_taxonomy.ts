
/**
 * EDINET Taxonomy Types (Auto-generated)
 * Based on: 2024 Version EDINET Taxonomy - General Commercial and Industrial
 * 財務諸表本表タクソノミ (jppfs_cor)
 */
export interface JppfsCorTaxonomy {
    /**
     * 貸借対照表
     * Namespace: jppfs_cor
     */
    BalanceSheetAbstract?: string;

    /**
     * 貸借対照表
     * Namespace: jppfs_cor
     */
    BalanceSheetTable?: string;

    /**
     * 貸借対照表
     * Namespace: jppfs_cor
     */
    BalanceSheetLineItems?: string;

    /**
     * 資産の部
     * Namespace: jppfs_cor
     */
    AssetsAbstract?: string;

    /**
     * 流動資産
     * Namespace: jppfs_cor
     */
    CurrentAssetsAbstract?: string;

    /**
     * 現金及び預金
     * Namespace: jppfs_cor
     */
    CashAndDeposits?: number;

    /**
     * 受取手形、売掛金及び契約資産
     * Namespace: jppfs_cor
     */
    NotesAndAccountsReceivableTradeAndContractAssets?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsNotesAndAccountsReceivableTradeAndContractAssets?: number;

    /**
     * 受取手形、売掛金及び契約資産（純額）
     * Namespace: jppfs_cor
     */
    NotesAndAccountsReceivableTradeAndContractAssetsNet?: number;

    /**
     * 受取手形及び売掛金
     * Namespace: jppfs_cor
     */
    NotesAndAccountsReceivableTrade?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsNotesAndAccountsReceivableTrade?: number;

    /**
     * 受取手形及び売掛金（純額）
     * Namespace: jppfs_cor
     */
    NotesAndAccountsReceivableTradeNet?: number;

    /**
     * 売掛金及び契約資産
     * Namespace: jppfs_cor
     */
    AccountsReceivableTradeAndContractAssets?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsAccountsReceivableTradeAndContractAssets?: number;

    /**
     * 売掛金及び契約資産（純額）
     * Namespace: jppfs_cor
     */
    AccountsReceivableTradeAndContractAssetsNet?: number;

    /**
     * 受取手形
     * Namespace: jppfs_cor
     */
    NotesReceivableTrade?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsNotesReceivableTrade?: number;

    /**
     * 受取手形（純額）
     * Namespace: jppfs_cor
     */
    NotesReceivableTradeNet?: number;

    /**
     * 売掛金
     * Namespace: jppfs_cor
     */
    AccountsReceivableTrade?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsAccountsReceivableTrade?: number;

    /**
     * 売掛金（純額）
     * Namespace: jppfs_cor
     */
    AccountsReceivableTradeNet?: number;

    /**
     * 契約資産
     * Namespace: jppfs_cor
     */
    ContractAssets?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsContractAssets?: number;

    /**
     * 契約資産（純額）
     * Namespace: jppfs_cor
     */
    ContractAssetsNet?: number;

    /**
     * 関係会社売掛金
     * Namespace: jppfs_cor
     */
    AccountsReceivableFromSubsidiariesAndAffiliatesTrade?: number;

    /**
     * 割賦売掛金
     * Namespace: jppfs_cor
     */
    AccountsReceivableInstallment?: number;

    /**
     * 開発事業未収入金
     * Namespace: jppfs_cor
     */
    AccountsReceivableDevelopmentBusiness?: number;

    /**
     * 不動産事業未収入金
     * Namespace: jppfs_cor
     */
    AccountsReceivableRealEstateBusiness?: number;

    /**
     * 完成業務未収入金
     * Namespace: jppfs_cor
     */
    AccountsReceivableCompletedOperation?: number;

    /**
     * 加盟店貸勘定
     * Namespace: jppfs_cor
     */
    AccountsReceivableDueFromFranchisedStores?: number;

    /**
     * 受取手形及び営業未収入金
     * Namespace: jppfs_cor
     */
    NotesAndOperatingAccountsReceivableCA?: number;

    /**
     * 営業未収入金
     * Namespace: jppfs_cor
     */
    OperatingAccountsReceivableCA?: number;

    /**
     * 電子記録債権
     * Namespace: jppfs_cor
     */
    ElectronicallyRecordedMonetaryClaimsOperatingCA?: number;

    /**
     * 営業貸付金
     * Namespace: jppfs_cor
     */
    OperatingLoansCA?: number;

    /**
     * 売買目的有価証券及び１年内に満期の到来する有価証券
     * Namespace: jppfs_cor
     */
    SecuritiesTradingAndMaturedWithinOneYearAbstract?: string;

    /**
     * 有価証券
     * Namespace: jppfs_cor
     */
    ShortTermInvestmentSecurities?: number;

    /**
     * 親会社株式
     * Namespace: jppfs_cor
     */
    StocksOfParentCompanyCA?: number;

    /**
     * 金銭の信託
     * Namespace: jppfs_cor
     */
    MoneyHeldInTrustCA?: number;

    /**
     * 営業投資有価証券
     * Namespace: jppfs_cor
     */
    OperationalInvestmentSecuritiesCA?: number;

    /**
     * 棚卸資産
     * Namespace: jppfs_cor
     */
    Inventories?: number;

    /**
     * 商品
     * Namespace: jppfs_cor
     */
    Merchandise?: number;

    /**
     * 未着商品
     * Namespace: jppfs_cor
     */
    GoodsInTransit?: number;

    /**
     * 製品、副産物及び作業くず
     * Namespace: jppfs_cor
     */
    FinishedGoodsByProductsAndScrapsCAAbstract?: string;

    /**
     * 製品
     * Namespace: jppfs_cor
     */
    FinishedGoods?: number;

    /**
     * 商品及び製品
     * Namespace: jppfs_cor
     */
    MerchandiseAndFinishedGoods?: number;

    /**
     * 半製品
     * Namespace: jppfs_cor
     */
    SemiFinishedGoods?: number;

    /**
     * 原料及び材料
     * Namespace: jppfs_cor
     */
    RawMaterialsAndMaterialsCAAbstract?: string;

    /**
     * 原材料
     * Namespace: jppfs_cor
     */
    RawMaterials?: number;

    /**
     * 原材料及び貯蔵品
     * Namespace: jppfs_cor
     */
    RawMaterialsAndSupplies?: number;

    /**
     * 未着原材料
     * Namespace: jppfs_cor
     */
    RawMaterialsInTransit?: number;

    /**
     * 仕掛品及び半成工事
     * Namespace: jppfs_cor
     */
    WorkInProcessAndPartlyFinishedConstructionCAAbstract?: string;

    /**
     * 仕掛品
     * Namespace: jppfs_cor
     */
    WorkInProcess?: number;

    /**
     * 半成工事
     * Namespace: jppfs_cor
     */
    PartlyFinishedWork?: number;

    /**
     * 消耗品、消耗工具、器具及び備品その他の貯蔵品で相当額以上のもの
     * Namespace: jppfs_cor
     */
    SuppliesAndOtherReasonableValueCAAbstract?: string;

    /**
     * 貯蔵品
     * Namespace: jppfs_cor
     */
    Supplies?: number;

    /**
     * 販売用不動産
     * Namespace: jppfs_cor
     */
    RealEstateForSale?: number;

    /**
     * 仕掛販売用不動産
     * Namespace: jppfs_cor
     */
    RealEstateForSaleInProcess?: number;

    /**
     * 開発事業等支出金
     * Namespace: jppfs_cor
     */
    DevelopmentProjectsInProgress?: number;

    /**
     * 不動産事業支出金
     * Namespace: jppfs_cor
     */
    CostsOnRealEstateBusiness?: number;

    /**
     * 未成業務支出金
     * Namespace: jppfs_cor
     */
    CostsOnUncompletedServices?: number;

    /**
     * 分譲土地建物
     * Namespace: jppfs_cor
     */
    LandAndBuildingsForSaleInLots?: number;

    /**
     * 分譲土地
     * Namespace: jppfs_cor
     */
    LandForSaleInLots?: number;

    /**
     * その他の棚卸資産
     * Namespace: jppfs_cor
     */
    OtherInventories?: number;

    /**
     * 前渡金
     * Namespace: jppfs_cor
     */
    AdvancePaymentsTrade?: number;

    /**
     * 前払金
     * Namespace: jppfs_cor
     */
    AdvancePaymentsOther?: number;

    /**
     * 前払費用
     * Namespace: jppfs_cor
     */
    PrepaidExpenses?: number;

    /**
     * 未収収益
     * Namespace: jppfs_cor
     */
    AccruedIncome?: number;

    /**
     * 未収利息
     * Namespace: jppfs_cor
     */
    AccruedInterest?: number;

    /**
     * その他の資産で１年内に現金化できると認められるもの
     * Namespace: jppfs_cor
     */
    OtherAssetsEncashedWithinOneYearAbstract?: string;

    /**
     * 株主、役員又は従業員に対する短期債権
     * Namespace: jppfs_cor
     */
    ShortTermClaimsOnShareholdersDirectorsOrEmployees?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsShortTermClaimsOnShareholdersDirectorsOrEmployees?: number;

    /**
     * 株主、役員又は従業員に対する短期債権（純額）
     * Namespace: jppfs_cor
     */
    ShortTermClaimsOnShareholdersDirectorsOrEmployeesNet?: number;

    /**
     * 短期貸付金
     * Namespace: jppfs_cor
     */
    ShortTermLoansReceivable?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsShortTermLoans?: number;

    /**
     * 短期貸付金（純額）
     * Namespace: jppfs_cor
     */
    ShortTermLoansReceivableNet?: number;

    /**
     * 関係会社短期貸付金
     * Namespace: jppfs_cor
     */
    ShortTermLoansReceivableToSubsidiariesAndAffiliates?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsShortTermLoansReceivableFromSubsidiariesAndAffiliates?: number;

    /**
     * 関係会社短期貸付金（純額）
     * Namespace: jppfs_cor
     */
    ShortTermLoansReceivableToSubsidiariesAndAffiliatesNet?: number;

    /**
     * 未収入金
     * Namespace: jppfs_cor
     */
    AccountsReceivableOther?: number;

    /**
     * 関係会社未収入金
     * Namespace: jppfs_cor
     */
    AccountsReceivableOtherFromSubsidiariesAndAffiliates?: number;

    /**
     * 未収消費税等
     * Namespace: jppfs_cor
     */
    ConsumptionTaxesReceivable?: number;

    /**
     * 未収還付法人税等
     * Namespace: jppfs_cor
     */
    IncomeTaxesReceivable?: number;

    /**
     * 営業外受取手形
     * Namespace: jppfs_cor
     */
    NonOperatingNotesReceivable?: number;

    /**
     * 営業外電子記録債権
     * Namespace: jppfs_cor
     */
    ElectronicallyRecordedMonetaryClaimsNonOperatingCA?: number;

    /**
     * １年内回収予定の長期貸付金
     * Namespace: jppfs_cor
     */
    CurrentPortionOfLongTermLoansReceivable?: number;

    /**
     * １年内回収予定の関係会社長期貸付金
     * Namespace: jppfs_cor
     */
    CurrentPortionOfLongTermLoansReceivableFromSubsidiariesAndAffiliates?: number;

    /**
     * １年内回収予定の差入保証金
     * Namespace: jppfs_cor
     */
    CurrentPortionOfGuaranteeDeposits?: number;

    /**
     * その他の未収入金
     * Namespace: jppfs_cor
     */
    OtherAccountsReceivable?: number;

    /**
     * 関係会社預け金
     * Namespace: jppfs_cor
     */
    DepositPaidInSubsidiariesAndAffiliates?: number;

    /**
     * 関係会社短期債権
     * Namespace: jppfs_cor
     */
    ShortTermReceivablesFromSubsidiariesAndAffiliates?: number;

    /**
     * 金銭債権信託受益権
     * Namespace: jppfs_cor
     */
    BeneficiaryRightOfAccountsReceivableInTrust?: number;

    /**
     * 差入保証金
     * Namespace: jppfs_cor
     */
    GuaranteeDepositsCA?: number;

    /**
     * 従業員に対する短期債権
     * Namespace: jppfs_cor
     */
    ShortTermClaimsOnEmployees?: number;

    /**
     * 従業員に対する短期貸付金
     * Namespace: jppfs_cor
     */
    ShortTermLoansToEmployees?: number;

    /**
     * 信託受益権
     * Namespace: jppfs_cor
     */
    TrustBeneficiaryRightCA?: number;

    /**
     * 立替金
     * Namespace: jppfs_cor
     */
    AdvancesPaid?: number;

    /**
     * 仮払金
     * Namespace: jppfs_cor
     */
    SuspensePayments?: number;

    /**
     * 預け金
     * Namespace: jppfs_cor
     */
    DepositsPaid?: number;

    /**
     * リース債権
     * Namespace: jppfs_cor
     */
    LeaseReceivablesCA?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsLeaseReceivablesCA?: number;

    /**
     * リース債権（純額）
     * Namespace: jppfs_cor
     */
    LeaseReceivablesNetCA?: number;

    /**
     * リース投資資産
     * Namespace: jppfs_cor
     */
    LeaseInvestmentAssetsCA?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsLeaseInvestmentAssetsCA?: number;

    /**
     * リース投資資産（純額）
     * Namespace: jppfs_cor
     */
    LeaseInvestmentAssetsNetCA?: number;

    /**
     * リース債権及びリース投資資産
     * Namespace: jppfs_cor
     */
    LeaseReceivablesAndInvestmentAssetsCA?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsLeaseReceivablesAndInvestmentAssetsCA?: number;

    /**
     * リース債権及びリース投資資産（純額）
     * Namespace: jppfs_cor
     */
    LeaseReceivablesAndInvestmentAssetsNetCA?: number;

    /**
     * デリバティブ債権
     * Namespace: jppfs_cor
     */
    DerivativesCA?: number;

    /**
     * 為替予約
     * Namespace: jppfs_cor
     */
    ForwardExchangeContractsCA?: number;

    /**
     * 金利スワップ資産
     * Namespace: jppfs_cor
     */
    InterestRateSwapAssetsCA?: number;

    /**
     * 金利スワップ
     * Namespace: jppfs_cor
     */
    InterestRateSwapCA?: number;

    /**
     * 買建通貨オプション
     * Namespace: jppfs_cor
     */
    PurchasedCurrencyOptionCA?: number;

    /**
     * 通貨オプション
     * Namespace: jppfs_cor
     */
    CurrencyOptionCA?: number;

    /**
     * 前払年金費用
     * Namespace: jppfs_cor
     */
    PrepaidPensionCostCA?: number;

    /**
     * 流動資産に属する資産に係る引当金
     * Namespace: jppfs_cor
     */
    AllowanceCurrentAssetsAbstract?: string;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsCA?: number;

    /**
     * 信用保証割賦売掛金
     * Namespace: jppfs_cor
     */
    AccountsReceivableInstallmentSalesCreditGuaranteeCA?: number;

    /**
     * 貸借取引貸付金
     * Namespace: jppfs_cor
     */
    LoansOnMarginTransactionCA?: number;

    /**
     * 借入有価証券代り金
     * Namespace: jppfs_cor
     */
    CollateralMoneyForSecuritiesBorrowedCA?: number;

    /**
     * 買取債権
     * Namespace: jppfs_cor
     */
    PurchasedReceivablesCA?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherCA?: number;

    /**
     * 流動資産
     * Namespace: jppfs_cor
     */
    CurrentAssets?: number;

    /**
     * 固定資産
     * Namespace: jppfs_cor
     */
    NoncurrentAssetsAbstract?: string;

    /**
     * 有形固定資産
     * Namespace: jppfs_cor
     */
    PropertyPlantAndEquipmentAbstract?: string;

    /**
     * 建物及び暖房、照明、通風等の附属設備
     * Namespace: jppfs_cor
     */
    BuildingsAndOtherFacilitiesHeatingIlluminationVentilationAndOtherPPEAbstract?: string;

    /**
     * 建物
     * Namespace: jppfs_cor
     */
    Buildings?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationBuildings?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossBuildings?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossBuildings?: number;

    /**
     * 建物（純額）
     * Namespace: jppfs_cor
     */
    BuildingsNet?: number;

    /**
     * 建物附属設備
     * Namespace: jppfs_cor
     */
    BuildingsAndAccompanyingFacilities?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationBuildingsAndAccompanyingFacilities?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossBuildingsAndAccompanyingFacilities?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossBuildingsAndAccompanyingFacilities?: number;

    /**
     * 建物附属設備（純額）
     * Namespace: jppfs_cor
     */
    BuildingsAndAccompanyingFacilitiesNet?: number;

    /**
     * 構築物
     * Namespace: jppfs_cor
     */
    Structures?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationStructures?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossStructures?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossStructures?: number;

    /**
     * 構築物（純額）
     * Namespace: jppfs_cor
     */
    StructuresNet?: number;

    /**
     * 建物及び構築物
     * Namespace: jppfs_cor
     */
    BuildingsAndStructures?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationBuildingsAndStructures?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossBuildingsAndStructures?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossBuildingsAndStructures?: number;

    /**
     * 建物及び構築物（純額）
     * Namespace: jppfs_cor
     */
    BuildingsAndStructuresNet?: number;

    /**
     * 機械及び装置並びにコンベヤー、ホイスト、起重機等の搬送設備その他の附属設備
     * Namespace: jppfs_cor
     */
    MachineryEquipmentAndOtherFacilitiesConveyorHoistCraneAndOtherPPEAbstract?: string;

    /**
     * 機械及び装置
     * Namespace: jppfs_cor
     */
    MachineryAndEquipment?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationMachineryAndEquipment?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossMachineryAndEquipment?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossMachineryAndEquipment?: number;

    /**
     * 機械及び装置（純額）
     * Namespace: jppfs_cor
     */
    MachineryAndEquipmentNet?: number;

    /**
     * 船舶及び水上運搬具
     * Namespace: jppfs_cor
     */
    VesselsAndWaterDeliveryEquipmentPPEAbstract?: string;

    /**
     * 船舶
     * Namespace: jppfs_cor
     */
    Vessels?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationVessels?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossVessels?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossVessels?: number;

    /**
     * 船舶（純額）
     * Namespace: jppfs_cor
     */
    VesselsNet?: number;

    /**
     * 鉄道車両、自動車その他の陸上運搬具
     * Namespace: jppfs_cor
     */
    RailwayCarAndOtherLandDeliveryEquipmentPPEAbstract?: string;

    /**
     * 車両運搬具
     * Namespace: jppfs_cor
     */
    Vehicles?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationVehicles?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossVehicles?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossVehicles?: number;

    /**
     * 車両運搬具（純額）
     * Namespace: jppfs_cor
     */
    VehiclesNet?: number;

    /**
     * 工具、器具及び備品
     * Namespace: jppfs_cor
     */
    ToolsFurnitureAndFixtures?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationToolsFurnitureAndFixtures?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossToolsFurnitureAndFixtures?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossToolsFurnitureAndFixtures?: number;

    /**
     * 工具、器具及び備品（純額）
     * Namespace: jppfs_cor
     */
    ToolsFurnitureAndFixturesNet?: number;

    /**
     * 機械装置及び運搬具
     * Namespace: jppfs_cor
     */
    MachineryEquipmentAndVehicles?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationMachineryEquipmentAndVehicles?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossMachineryEquipmentAndVehicles?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossMachineryEquipmentAndVehicles?: number;

    /**
     * 機械装置及び運搬具（純額）
     * Namespace: jppfs_cor
     */
    MachineryEquipmentAndVehiclesNet?: number;

    /**
     * 車両運搬具及び工具器具備品
     * Namespace: jppfs_cor
     */
    VehiclesToolsFurnitureAndFixtures?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationVehiclesToolsFurnitureAndFixtures?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossVehiclesToolsFurnitureAndFixtures?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossVehiclesToolsFurnitureAndFixtures?: number;

    /**
     * 車両運搬具及び工具器具備品（純額）
     * Namespace: jppfs_cor
     */
    VehiclesToolsFurnitureAndFixturesNet?: number;

    /**
     * 機械、運搬具及び工具器具備品
     * Namespace: jppfs_cor
     */
    MachineryVehiclesToolsFurnitureAndFixtures?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationMachineryVehiclesToolsFurnitureAndFixtures?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossMachineryVehiclesToolsFurnitureAndFixtures?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossMachineryVehiclesToolsFurnitureAndFixtures?: number;

    /**
     * 機械、運搬具及び工具器具備品（純額）
     * Namespace: jppfs_cor
     */
    MachineryVehiclesToolsFurnitureAndFixturesNet?: number;

    /**
     * 土地
     * Namespace: jppfs_cor
     */
    Land?: number;

    /**
     * リース資産
     * Namespace: jppfs_cor
     */
    LeaseAssetsPPE?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationLeaseAssetsPPE?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossLeaseAssetsPPE?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossLeaseAssetsPPE?: number;

    /**
     * リース資産（純額）
     * Namespace: jppfs_cor
     */
    LeaseAssetsNetPPE?: number;

    /**
     * 建設仮勘定
     * Namespace: jppfs_cor
     */
    ConstructionInProgress?: number;

    /**
     * その他の有形固定資産で流動資産または投資たる資産に属しないもの
     * Namespace: jppfs_cor
     */
    OtherTangibleAssetsNotCurrentOrInvestmentsAbstract?: string;

    /**
     * 航空機
     * Namespace: jppfs_cor
     */
    Aircraft?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAircraft?: number;

    /**
     * 航空機（純額）
     * Namespace: jppfs_cor
     */
    AircraftNet?: number;

    /**
     * 山林
     * Namespace: jppfs_cor
     */
    MountainForests?: number;

    /**
     * 貸与資産
     * Namespace: jppfs_cor
     */
    AssetsForRent?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAssetsForRent?: number;

    /**
     * 貸与資産（純額）
     * Namespace: jppfs_cor
     */
    AssetsForRentNet?: number;

    /**
     * 賃貸不動産
     * Namespace: jppfs_cor
     */
    RealEstateForRent?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationRealEstateForRent?: number;

    /**
     * 賃貸不動産（純額）
     * Namespace: jppfs_cor
     */
    RealEstateForRentNet?: number;

    /**
     * 立木
     * Namespace: jppfs_cor
     */
    TreesPPE?: number;

    /**
     * その他の設備
     * Namespace: jppfs_cor
     */
    OtherFacilitiesPPE?: number;

    /**
     * コース勘定
     * Namespace: jppfs_cor
     */
    GolfCourses?: number;

    /**
     * ドック船台
     * Namespace: jppfs_cor
     */
    DocksAndBuildingBerthsVES?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationDocksAndBuildingBerthsVES?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossDocksAndBuildingBerths?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossDocksAndBuildingBerths?: number;

    /**
     * ドック船台（純額）
     * Namespace: jppfs_cor
     */
    DocksAndBuildingBerthsNetVES?: number;

    /**
     * 使用権資産
     * Namespace: jppfs_cor
     */
    RightOfUseAssets?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationRightOfUseAssets?: number;

    /**
     * 使用権資産（純額）
     * Namespace: jppfs_cor
     */
    RightOfUseAssetsNet?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherPPE?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationOtherPPE?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossOtherPPE?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossOtherPPE?: number;

    /**
     * その他（純額）
     * Namespace: jppfs_cor
     */
    OtherNetPPE?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationPPEByGroup?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossPPEByGroup?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossPPEByGroup?: number;

    /**
     * 有形固定資産
     * Namespace: jppfs_cor
     */
    PropertyPlantAndEquipment?: number;

    /**
     * 無形固定資産
     * Namespace: jppfs_cor
     */
    IntangibleAssetsAbstract?: string;

    /**
     * 特許権
     * Namespace: jppfs_cor
     */
    PatentRight?: number;

    /**
     * 借地権
     * Namespace: jppfs_cor
     */
    LeaseholdRight?: number;

    /**
     * 地上権
     * Namespace: jppfs_cor
     */
    SurfaceRight?: number;

    /**
     * 商標権
     * Namespace: jppfs_cor
     */
    RightOfTrademark?: number;

    /**
     * 実用新案権
     * Namespace: jppfs_cor
     */
    UtilityModelRight?: number;

    /**
     * 意匠権
     * Namespace: jppfs_cor
     */
    DesignRight?: number;

    /**
     * 鉱業権
     * Namespace: jppfs_cor
     */
    MiningRight?: number;

    /**
     * 漁業権
     * Namespace: jppfs_cor
     */
    FisheryRight?: number;

    /**
     * 入漁権
     * Namespace: jppfs_cor
     */
    CommonOfPiscary?: number;

    /**
     * ソフトウエア
     * Namespace: jppfs_cor
     */
    Software?: number;

    /**
     * ソフトウエア仮勘定
     * Namespace: jppfs_cor
     */
    SoftwareInProgress?: number;

    /**
     * のれん
     * Namespace: jppfs_cor
     */
    Goodwill?: number;

    /**
     * リース資産
     * Namespace: jppfs_cor
     */
    LeaseAssetsIA?: number;

    /**
     * 公共施設等運営権
     * Namespace: jppfs_cor
     */
    RightToOperatePublicFacilities?: number;

    /**
     * その他の無形資産で流動資産又は投資たる資産に属しないもの
     * Namespace: jppfs_cor
     */
    OtherIntangibleAssetsIAAbstract?: string;

    /**
     * 施設利用権
     * Namespace: jppfs_cor
     */
    RightOfUsingFacilitiesIA?: number;

    /**
     * 電話加入権
     * Namespace: jppfs_cor
     */
    TelephoneSubscriptionRight?: number;

    /**
     * 電気供給施設利用権
     * Namespace: jppfs_cor
     */
    RightOfUsingElectricSupplyFacilities?: number;

    /**
     * 電気通信施設利用権
     * Namespace: jppfs_cor
     */
    RightOfUsingTelecommunicationFacilities?: number;

    /**
     * 電信電話専用施設利用権
     * Namespace: jppfs_cor
     */
    RightOfUsingTelephoneAndTelegraphFacilities?: number;

    /**
     * 公共施設利用権
     * Namespace: jppfs_cor
     */
    RightOfUsingPublicFacilities?: number;

    /**
     * 水道施設利用権
     * Namespace: jppfs_cor
     */
    RightOfUsingWaterFacilities?: number;

    /**
     * その他の施設利用権
     * Namespace: jppfs_cor
     */
    RightOfUsingOtherFacilities?: number;

    /**
     * 工業所有権
     * Namespace: jppfs_cor
     */
    IndustrialProperty?: number;

    /**
     * 借家権
     * Namespace: jppfs_cor
     */
    HouseLeaseholdRight?: number;

    /**
     * 特許実施権
     * Namespace: jppfs_cor
     */
    RightOfUsingPatent?: number;

    /**
     * 顧客関連資産
     * Namespace: jppfs_cor
     */
    CustomerRelatedIntangibleAssets?: number;

    /**
     * 水利権
     * Namespace: jppfs_cor
     */
    WaterRight?: number;

    /**
     * 版権
     * Namespace: jppfs_cor
     */
    CopyrightPublishing?: number;

    /**
     * 著作権
     * Namespace: jppfs_cor
     */
    Copyright?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherIA?: number;

    /**
     * 無形固定資産
     * Namespace: jppfs_cor
     */
    IntangibleAssets?: number;

    /**
     * 投資その他の資産
     * Namespace: jppfs_cor
     */
    InvestmentsAndOtherAssetsAbstract?: string;

    /**
     * 関係会社株式その他流動資産に属しない有価証券
     * Namespace: jppfs_cor
     */
    StocksOfSubsidiariesAndAffiliatesAndOtherNoncurrentSecuritiesIOAAbstract?: string;

    /**
     * 投資有価証券
     * Namespace: jppfs_cor
     */
    InvestmentSecurities?: number;

    /**
     * 関係会社株式
     * Namespace: jppfs_cor
     */
    StocksOfSubsidiariesAndAffiliates?: number;

    /**
     * 関係会社社債
     * Namespace: jppfs_cor
     */
    BondsOfSubsidiariesAndAffiliates?: number;

    /**
     * その他の関係会社有価証券
     * Namespace: jppfs_cor
     */
    InvestmentsInOtherSecuritiesOfSubsidiariesAndAffiliates?: number;

    /**
     * 営業投資有価証券
     * Namespace: jppfs_cor
     */
    OperationalInvestmentSecuritiesIOA?: number;

    /**
     * 出資金
     * Namespace: jppfs_cor
     */
    InvestmentsInCapitalAbstract?: string;

    /**
     * 出資金
     * Namespace: jppfs_cor
     */
    InvestmentsInCapital?: number;

    /**
     * 関係会社出資金
     * Namespace: jppfs_cor
     */
    InvestmentsInCapitalOfSubsidiariesAndAffiliates?: number;

    /**
     * 営業出資金
     * Namespace: jppfs_cor
     */
    OperatingInvestmentsInCapital?: number;

    /**
     * 匿名組合出資金
     * Namespace: jppfs_cor
     */
    InvestmentsInSilentPartnership?: number;

    /**
     * 長期貸付金
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableAbstract?: string;

    /**
     * 長期貸付金
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivable?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsLongTermLoansReceivable?: number;

    /**
     * 長期貸付金（純額）
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableNet?: number;

    /**
     * 関係会社長期貸付金
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableFromSubsidiariesAndAffiliates?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsLongTermLoansReceivableFromSubsidiariesAndAffiliates?: number;

    /**
     * 関係会社長期貸付金（純額）
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableFromSubsidiariesAndAffiliatesNet?: number;

    /**
     * 株主、役員又は従業員に対する長期貸付金
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableFromShareholdersDirectorsOrEmployees?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsLongTermLoansReceivableFromShareholdersDirectorsOrEmployees?: number;

    /**
     * 株主、役員又は従業員に対する長期貸付金（純額）
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableFromShareholdersDirectorsOrEmployeesNet?: number;

    /**
     * 従業員に対する長期貸付金
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableFromEmployees?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsLongTermLoansReceivableFromEmployees?: number;

    /**
     * 従業員に対する長期貸付金（純額）
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableFromEmployeesNet?: number;

    /**
     * 役員及び従業員に対する長期貸付金
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableFromDirectorsAndEmployees?: number;

    /**
     * 役員に対する長期貸付金
     * Namespace: jppfs_cor
     */
    LongTermLoansReceivableFromDirectors?: number;

    /**
     * 前各号に掲げられるものの外、流動資産、有形固定資産、無形固定資産又は繰延資産に属するもの以外の長期資産
     * Namespace: jppfs_cor
     */
    OtherLongTermAssetsIOAAbstract?: string;

    /**
     * 親会社株式
     * Namespace: jppfs_cor
     */
    StocksOfParentCompanyIOA?: number;

    /**
     * 破産更生債権等
     * Namespace: jppfs_cor
     */
    ClaimsProvableInBankruptcyClaimsProvableInRehabilitationAndOther?: number;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsClaimsInBankruptcyReorganizationClaimsAndOther?: number;

    /**
     * 破産更生債権等（純額）
     * Namespace: jppfs_cor
     */
    ClaimsProvableInBankruptcyClaimsProvableInRehabilitationAndOtherNet?: number;

    /**
     * 長期前払費用
     * Namespace: jppfs_cor
     */
    LongTermPrepaidExpenses?: number;

    /**
     * 長期前払消費税等
     * Namespace: jppfs_cor
     */
    LongTermPrepaidConsumptionTaxes?: number;

    /**
     * 前払年金費用
     * Namespace: jppfs_cor
     */
    PrepaidPensionCostIOA?: number;

    /**
     * 退職給付に係る資産
     * Namespace: jppfs_cor
     */
    NetDefinedBenefitAsset?: number;

    /**
     * 繰延税金資産
     * Namespace: jppfs_cor
     */
    DeferredTaxAssets?: number;

    /**
     * 再評価に係る繰延税金資産
     * Namespace: jppfs_cor
     */
    DeferredTaxAssetsForLandRevaluation?: number;

    /**
     * 投資不動産
     * Namespace: jppfs_cor
     */
    RealEstateForInvestment?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationRealEstateForInvestment?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossRealEstateForInvestment?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossRealEstateForInvestment?: number;

    /**
     * 投資不動産（純額）
     * Namespace: jppfs_cor
     */
    RealEstateForInvestmentNet?: number;

    /**
     * 不動産信託受益権
     * Namespace: jppfs_cor
     */
    BeneficiaryRightOfRealEstateInTrust?: number;

    /**
     * 信託土地
     * Namespace: jppfs_cor
     */
    LandInTrust?: number;

    /**
     * 信託建物
     * Namespace: jppfs_cor
     */
    BuildingsInTrust?: number;

    /**
     * リース投資資産
     * Namespace: jppfs_cor
     */
    LeaseInvestmentAssetsIOA?: number;

    /**
     * デリバティブ債権
     * Namespace: jppfs_cor
     */
    DerivativesIOA?: number;

    /**
     * 為替予約
     * Namespace: jppfs_cor
     */
    ForwardExchangeContractsIOA?: number;

    /**
     * 金利スワップ資産
     * Namespace: jppfs_cor
     */
    InterestRateSwapAssetsIOA?: number;

    /**
     * 金利スワップ
     * Namespace: jppfs_cor
     */
    InterestRateSwapIOA?: number;

    /**
     * 買建通貨オプション
     * Namespace: jppfs_cor
     */
    PurchasedCurrencyOptionIOA?: number;

    /**
     * 通貨オプション
     * Namespace: jppfs_cor
     */
    CurrencyOptionIOA?: number;

    /**
     * 長期預け金
     * Namespace: jppfs_cor
     */
    LongTermDeposits?: number;

    /**
     * 長期預金
     * Namespace: jppfs_cor
     */
    LongTermTimeDeposits?: number;

    /**
     * 保険積立金
     * Namespace: jppfs_cor
     */
    InsuranceFunds?: number;

    /**
     * 生命保険積立金
     * Namespace: jppfs_cor
     */
    LifeInsuranceFunds?: number;

    /**
     * 団体生命保険金
     * Namespace: jppfs_cor
     */
    GroupLifeInsurance?: number;

    /**
     * 会員権
     * Namespace: jppfs_cor
     */
    Membership?: number;

    /**
     * ゴルフ会員権
     * Namespace: jppfs_cor
     */
    GolfClubMembership?: number;

    /**
     * 施設利用会員権
     * Namespace: jppfs_cor
     */
    FacilityMembership?: number;

    /**
     * 差入保証金
     * Namespace: jppfs_cor
     */
    GuaranteeDepositsIOA?: number;

    /**
     * 関係会社長期未収入金
     * Namespace: jppfs_cor
     */
    LongTermAccountsReceivableFromSubsidiariesAndAffiliates?: number;

    /**
     * 敷金
     * Namespace: jppfs_cor
     */
    LeaseDepositsIOA?: number;

    /**
     * 敷金及び保証金
     * Namespace: jppfs_cor
     */
    LeaseAndGuaranteeDeposits?: number;

    /**
     * 固定化営業債権
     * Namespace: jppfs_cor
     */
    BadDebts?: number;

    /**
     * 事業保険積立金
     * Namespace: jppfs_cor
     */
    BusinessInsuranceFunds?: number;

    /**
     * 事業保険金
     * Namespace: jppfs_cor
     */
    BusinessInsurance?: number;

    /**
     * 入会金
     * Namespace: jppfs_cor
     */
    AdmissionFeeIOA?: number;

    /**
     * 入会保証金
     * Namespace: jppfs_cor
     */
    DepositsOnAdmission?: number;

    /**
     * 信託受益権
     * Namespace: jppfs_cor
     */
    TrustBeneficiaryRightIOA?: number;

    /**
     * 長期営業外未収入金
     * Namespace: jppfs_cor
     */
    LongTermNonOperatingAccountsReceivable?: number;

    /**
     * 長期未収入金
     * Namespace: jppfs_cor
     */
    LongTermAccountsReceivableOther?: number;

    /**
     * 建設協力金
     * Namespace: jppfs_cor
     */
    ConstructionAssistanceFundReceivables?: number;

    /**
     * 店舗賃借仮勘定
     * Namespace: jppfs_cor
     */
    DepositsForStoresInPreparation?: number;

    /**
     * 役員退職積立金
     * Namespace: jppfs_cor
     */
    FundForRetirementBenefitsForDirectorsIOA?: number;

    /**
     * 役員に対する保険積立金
     * Namespace: jppfs_cor
     */
    InsuranceFundsForDirectors?: number;

    /**
     * 長期投資
     * Namespace: jppfs_cor
     */
    LongTermInvestments?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherIOA?: number;

    /**
     * 投資その他の資産に属する資産に係る引当金
     * Namespace: jppfs_cor
     */
    AllowanceInvestmentAndOtherAssetsAbstract?: string;

    /**
     * 貸倒引当金
     * Namespace: jppfs_cor
     */
    AllowanceForDoubtfulAccountsIOAByGroup?: number;

    /**
     * 投資損失引当金
     * Namespace: jppfs_cor
     */
    AllowanceForInvestmentLoss?: number;

    /**
     * 投資その他の資産
     * Namespace: jppfs_cor
     */
    InvestmentsAndOtherAssetsGross?: number;

    /**
     * 減価償却累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationIOAByGroup?: number;

    /**
     * 減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossIOAByGroup?: number;

    /**
     * 減価償却累計額及び減損損失累計額
     * Namespace: jppfs_cor
     */
    AccumulatedDepreciationAndImpairmentLossIOAByGroup?: number;

    /**
     * 投資その他の資産
     * Namespace: jppfs_cor
     */
    InvestmentsAndOtherAssets?: number;

    /**
     * 固定資産
     * Namespace: jppfs_cor
     */
    NoncurrentAssets?: number;

    /**
     * 繰延資産
     * Namespace: jppfs_cor
     */
    DeferredAssetsAbstract?: string;

    /**
     * 創立費
     * Namespace: jppfs_cor
     */
    DeferredOrganizationExpensesDA?: number;

    /**
     * 開業費
     * Namespace: jppfs_cor
     */
    BusinessCommencementExpensesDA?: number;

    /**
     * 株式交付費
     * Namespace: jppfs_cor
     */
    StockIssuanceCostDA?: number;

    /**
     * 社債発行費
     * Namespace: jppfs_cor
     */
    BondIssuanceCostDA?: number;

    /**
     * 開発費
     * Namespace: jppfs_cor
     */
    DevelopmentExpensesDA?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherDA?: number;

    /**
     * 繰延資産
     * Namespace: jppfs_cor
     */
    DeferredAssets?: number;

    /**
     * 資産
     * Namespace: jppfs_cor
     */
    Assets?: number;

    /**
     * 負債の部
     * Namespace: jppfs_cor
     */
    LiabilitiesAbstract?: string;

    /**
     * 流動負債
     * Namespace: jppfs_cor
     */
    CurrentLiabilitiesAbstract?: string;

    /**
     * 支払手形及び買掛金
     * Namespace: jppfs_cor
     */
    NotesAndAccountsPayableTrade?: number;

    /**
     * 支払手形
     * Namespace: jppfs_cor
     */
    NotesPayableTrade?: number;

    /**
     * 買掛金
     * Namespace: jppfs_cor
     */
    AccountsPayableTrade?: number;

    /**
     * 営業未払金
     * Namespace: jppfs_cor
     */
    OperatingAccountsPayable?: number;

    /**
     * 支払手形及び営業未払金
     * Namespace: jppfs_cor
     */
    NotesAndOperatingAccountsPayableTrade?: number;

    /**
     * 電子記録債務
     * Namespace: jppfs_cor
     */
    ElectronicallyRecordedObligationsOperatingCL?: number;

    /**
     * 業務未払金
     * Namespace: jppfs_cor
     */
    AccountsPayableOperatingSpecific?: number;

    /**
     * 受託販売未払金
     * Namespace: jppfs_cor
     */
    AccountsPayableConsignment?: number;

    /**
     * 不動産事業未払金
     * Namespace: jppfs_cor
     */
    AccountsPayableRealEstate?: number;

    /**
     * 加盟店借勘定
     * Namespace: jppfs_cor
     */
    DueToFranchisedStores?: number;

    /**
     * 商品券
     * Namespace: jppfs_cor
     */
    GiftCertificates?: number;

    /**
     * 未成業務受入金
     * Namespace: jppfs_cor
     */
    AdvancesReceivedOnUncompletedContracts?: number;

    /**
     * 不動産事業受入金
     * Namespace: jppfs_cor
     */
    DepositReceivedRealEstate?: number;

    /**
     * 未払金及び未払費用
     * Namespace: jppfs_cor
     */
    AccountsPayableOtherAndAccruedExpenses?: number;

    /**
     * 未払費用
     * Namespace: jppfs_cor
     */
    AccruedExpenses?: number;

    /**
     * 契約負債
     * Namespace: jppfs_cor
     */
    ContractLiabilities?: number;

    /**
     * 前受金
     * Namespace: jppfs_cor
     */
    AdvancesReceived?: number;

    /**
     * 前受工事負担金
     * Namespace: jppfs_cor
     */
    DeferredContributionForConstruction?: number;

    /**
     * 前受収益
     * Namespace: jppfs_cor
     */
    UnearnedRevenue?: number;

    /**
     * リース債務
     * Namespace: jppfs_cor
     */
    LeaseObligationsCL?: number;

    /**
     * 資産除去債務
     * Namespace: jppfs_cor
     */
    AssetRetirementObligationsCL?: number;

    /**
     * 公共施設等運営権に係る負債
     * Namespace: jppfs_cor
     */
    LiabilitiesRelatedToRightToOperatePublicFacilitiesCL?: number;

    /**
     * デリバティブ債務
     * Namespace: jppfs_cor
     */
    DerivativesLiabilitiesCL?: number;

    /**
     * 為替予約
     * Namespace: jppfs_cor
     */
    ForwardExchangeContractsCL?: number;

    /**
     * 金利スワップ
     * Namespace: jppfs_cor
     */
    InterestRateSwapCL?: number;

    /**
     * 売建通貨オプション
     * Namespace: jppfs_cor
     */
    SoldCurrencyOptionCL?: number;

    /**
     * 通貨オプション
     * Namespace: jppfs_cor
     */
    CurrencyOptionCL?: number;

    /**
     * 引当金
     * Namespace: jppfs_cor
     */
    ProvisionCLAbstract?: string;

    /**
     * 製品保証引当金
     * Namespace: jppfs_cor
     */
    ProvisionForProductWarranties?: number;

    /**
     * 賞与引当金
     * Namespace: jppfs_cor
     */
    ProvisionForBonuses?: number;

    /**
     * 修繕引当金
     * Namespace: jppfs_cor
     */
    ProvisionForRepairs?: number;

    /**
     * 役員賞与引当金
     * Namespace: jppfs_cor
     */
    ProvisionForDirectorsBonuses?: number;

    /**
     * 債務保証損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnGuaranteesCL?: number;

    /**
     * ポイント引当金
     * Namespace: jppfs_cor
     */
    ProvisionForPointCardCertificatesCL?: number;

    /**
     * 株主優待引当金
     * Namespace: jppfs_cor
     */
    ProvisionForShareholderBenefitProgramCL?: number;

    /**
     * 売上割戻引当金
     * Namespace: jppfs_cor
     */
    ProvisionForSalesRebates?: number;

    /**
     * 工事損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnConstructionContracts?: number;

    /**
     * 完成工事補償引当金
     * Namespace: jppfs_cor
     */
    ProvisionForWarrantiesForCompletedConstruction?: number;

    /**
     * 店舗閉鎖損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnStoreClosing?: number;

    /**
     * 販売促進引当金
     * Namespace: jppfs_cor
     */
    ProvisionForSalesPromotionExpenses?: number;

    /**
     * 返品調整引当金
     * Namespace: jppfs_cor
     */
    ProvisionForSalesReturns?: number;

    /**
     * 受注損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnOrderReceivedCL?: number;

    /**
     * 関係会社整理損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnLiquidationOfSubsidiariesAndAffiliatesCL?: number;

    /**
     * 事業整理損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnBusinessLiquidationCL?: number;

    /**
     * 関係会社事業損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnBusinessOfSubsidiariesAndAffiliatesCL?: number;

    /**
     * 事業構造改善引当金
     * Namespace: jppfs_cor
     */
    ProvisionForBusinessStructureImprovementCL?: number;

    /**
     * 環境対策引当金
     * Namespace: jppfs_cor
     */
    ProvisionForEnvironmentalMeasuresCL?: number;

    /**
     * 訴訟損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnLitigationCL?: number;

    /**
     * 利息返還損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnInterestRepaymentCL?: number;

    /**
     * 偶発損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForContingentLossCL?: number;

    /**
     * 災害損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnDisasterCL?: number;

    /**
     * 受注工事損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnConstructionContractsVES?: number;

    /**
     * 船舶保証工事引当金
     * Namespace: jppfs_cor
     */
    ProvisionForConstructionWarrantiesForVesselVES?: number;

    /**
     * 保証工事引当金
     * Namespace: jppfs_cor
     */
    ProvisionForConstructionWarrantiesVES?: number;

    /**
     * 株式給付引当金
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedRemunerationCL?: number;

    /**
     * 役員株式給付引当金
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedRemunerationForDirectorsAndOtherOfficersCL?: number;

    /**
     * 株式報酬引当金
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedPaymentsCL?: number;

    /**
     * その他の引当金
     * Namespace: jppfs_cor
     */
    OtherProvisionCL?: number;

    /**
     * 引当金
     * Namespace: jppfs_cor
     */
    ProvisionCL?: number;

    /**
     * 通常の取引に関連して発生する未払金又は預り金で一般の取引慣行として発生後短期間に支払われるもの
     * Namespace: jppfs_cor
     */
    AccountsPayableOrdinaryTransactionsPaidInShortTermCLAbstract?: string;

    /**
     * 未払金
     * Namespace: jppfs_cor
     */
    AccountsPayableOther?: number;

    /**
     * 未払法人税等
     * Namespace: jppfs_cor
     */
    IncomeTaxesPayable?: number;

    /**
     * 未払事業所税
     * Namespace: jppfs_cor
     */
    AccruedBusinessOfficeTaxes?: number;

    /**
     * 未払消費税等
     * Namespace: jppfs_cor
     */
    AccruedConsumptionTaxes?: number;

    /**
     * 未払税金
     * Namespace: jppfs_cor
     */
    AccruedTaxes?: number;

    /**
     * 未払酒税
     * Namespace: jppfs_cor
     */
    AccruedAlcoholTax?: number;

    /**
     * 預り金
     * Namespace: jppfs_cor
     */
    DepositsReceived?: number;

    /**
     * 関係会社預り金
     * Namespace: jppfs_cor
     */
    DepositsReceivedFromSubsidiariesAndAffiliates?: number;

    /**
     * 未払代理店手数料
     * Namespace: jppfs_cor
     */
    AccruedAgencyCommission?: number;

    /**
     * １年内返還予定の預り保証金
     * Namespace: jppfs_cor
     */
    CurrentPortionOfGuaranteeDepositsReceived?: number;

    /**
     * その他の負債で１年内に支払又は返済されると認められるもの
     * Namespace: jppfs_cor
     */
    OtherLiabilitiesPayableWithinOneYearAbstract?: string;

    /**
     * 設備関係支払手形
     * Namespace: jppfs_cor
     */
    NotesPayableFacilities?: number;

    /**
     * 設備関係電子記録債務
     * Namespace: jppfs_cor
     */
    ElectronicallyRecordedObligationsFacilitiesCL?: number;

    /**
     * 設備関係未払金
     * Namespace: jppfs_cor
     */
    AccountsPayableFacilities?: number;

    /**
     * 営業外支払手形
     * Namespace: jppfs_cor
     */
    NotesPayableNonOperating?: number;

    /**
     * 営業外電子記録債務
     * Namespace: jppfs_cor
     */
    ElectronicallyRecordedObligationsNonOperatingCL?: number;

    /**
     * 短期社債
     * Namespace: jppfs_cor
     */
    ShortTermBondsPayable?: number;

    /**
     * 短期借入金
     * Namespace: jppfs_cor
     */
    ShortTermLoansPayable?: number;

    /**
     * 関係会社短期借入金
     * Namespace: jppfs_cor
     */
    ShortTermLoansPayableToSubsidiariesAndAffiliates?: number;

    /**
     * コマーシャル・ペーパー
     * Namespace: jppfs_cor
     */
    CommercialPapersLiabilities?: number;

    /**
     * １年内償還予定の社債
     * Namespace: jppfs_cor
     */
    CurrentPortionOfBonds?: number;

    /**
     * １年内返済予定の長期借入金
     * Namespace: jppfs_cor
     */
    CurrentPortionOfLongTermLoansPayable?: number;

    /**
     * １年内返済予定の関係会社長期借入金
     * Namespace: jppfs_cor
     */
    CurrentPortionOfLongTermLoansPayableToSubsidiariesAndAffiliates?: number;

    /**
     * １年内償還予定の転換社債
     * Namespace: jppfs_cor
     */
    CurrentPortionOfConvertibleBonds?: number;

    /**
     * １年内償還予定の新株予約権付社債
     * Namespace: jppfs_cor
     */
    CurrentPortionOfBondsWithSubscriptionRightsToShares?: number;

    /**
     * １年内期限到来予定のその他の固定負債
     * Namespace: jppfs_cor
     */
    CurrentPortionOfOtherNoncurrentLiabilities?: number;

    /**
     * 仮受金
     * Namespace: jppfs_cor
     */
    SuspenseReceipt?: number;

    /**
     * 仮受消費税等
     * Namespace: jppfs_cor
     */
    SuspenseReceiptOfConsumptionTaxes?: number;

    /**
     * 未払賞与
     * Namespace: jppfs_cor
     */
    AccruedBonuses?: number;

    /**
     * 未払役員報酬
     * Namespace: jppfs_cor
     */
    DirectorsCompensationPayable?: number;

    /**
     * 未払配当金
     * Namespace: jppfs_cor
     */
    DividendsPayable?: number;

    /**
     * 株主、役員又は従業員からの短期借入金
     * Namespace: jppfs_cor
     */
    ShortTermLoansPayableToShareholdersDirectorsOrEmployees?: number;

    /**
     * 株主、役員又は従業員からの預り金
     * Namespace: jppfs_cor
     */
    DepositsReceivedFromShareholdersDirectorsOrEmployees?: number;

    /**
     * 従業員預り金
     * Namespace: jppfs_cor
     */
    DepositsReceivedFromEmployees?: number;

    /**
     * 圧縮未決算特別勘定
     * Namespace: jppfs_cor
     */
    SpecialSuspenseAccountForReductionEntry?: number;

    /**
     * リース資産減損勘定
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossOnLeasedAssetsCL?: number;

    /**
     * 持分法適用に伴う負債
     * Namespace: jppfs_cor
     */
    LiabilitiesFromApplicationOfEquityMethodCL?: number;

    /**
     * 企業結合に係る特定勘定
     * Namespace: jppfs_cor
     */
    ProvisionIncurredFromABusinessCombinationCL?: number;

    /**
     * 組織再編により生じた株式の特別勘定
     * Namespace: jppfs_cor
     */
    StockSpecialAccountCausedByRestructuringCL?: number;

    /**
     * 割賦利益繰延
     * Namespace: jppfs_cor
     */
    DeferredInstallmentIncomeCL?: number;

    /**
     * 信用保証買掛金
     * Namespace: jppfs_cor
     */
    AccountsPayableCreditGuaranteeCL?: number;

    /**
     * 貸借取引担保金
     * Namespace: jppfs_cor
     */
    CollateralMoneyReceivedForLoanTransactionsCL?: number;

    /**
     * 貸付有価証券代り金
     * Namespace: jppfs_cor
     */
    CollateralMoneyReceivedForSecuritiesLentCL?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherCL?: number;

    /**
     * 流動負債
     * Namespace: jppfs_cor
     */
    CurrentLiabilities?: number;

    /**
     * 固定負債
     * Namespace: jppfs_cor
     */
    NoncurrentLiabilitiesAbstract?: string;

    /**
     * 社債
     * Namespace: jppfs_cor
     */
    BondsPayableAbstract?: string;

    /**
     * 社債
     * Namespace: jppfs_cor
     */
    BondsPayable?: number;

    /**
     * 転換社債
     * Namespace: jppfs_cor
     */
    ConvertibleBonds?: number;

    /**
     * 転換社債型新株予約権付社債
     * Namespace: jppfs_cor
     */
    ConvertibleBondTypeBondsWithSubscriptionRightsToShares?: number;

    /**
     * 新株予約権付社債
     * Namespace: jppfs_cor
     */
    BondsWithSubscriptionRightsToSharesNCL?: number;

    /**
     * 長期借入金
     * Namespace: jppfs_cor
     */
    LongTermLoansPayableAbstract?: string;

    /**
     * 長期借入金
     * Namespace: jppfs_cor
     */
    LongTermLoansPayable?: number;

    /**
     * 株主、役員又は従業員からの長期借入金
     * Namespace: jppfs_cor
     */
    LongTermLoansPayableToShareholdersDirectorsOrEmployees?: number;

    /**
     * 関係会社長期借入金
     * Namespace: jppfs_cor
     */
    LongTermLoansPayableToSubsidiariesAndAffiliates?: number;

    /**
     * 引当金
     * Namespace: jppfs_cor
     */
    ProvisionNCLAbstract?: string;

    /**
     * 退職給付引当金
     * Namespace: jppfs_cor
     */
    ProvisionForRetirementBenefits?: number;

    /**
     * 役員退職慰労引当金
     * Namespace: jppfs_cor
     */
    ProvisionForDirectorsRetirementBenefits?: number;

    /**
     * 債務保証損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnGuarantees?: number;

    /**
     * ポイント引当金
     * Namespace: jppfs_cor
     */
    ProvisionForPointCardCertificatesNCL?: number;

    /**
     * 特別修繕引当金
     * Namespace: jppfs_cor
     */
    ProvisionForSpecialRepairs?: number;

    /**
     * 修繕引当金
     * Namespace: jppfs_cor
     */
    ProvisionForRepairsNCL?: number;

    /**
     * 製品保証引当金
     * Namespace: jppfs_cor
     */
    ProvisionForProductWarrantiesNCL?: number;

    /**
     * 関係会社整理損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnLiquidationOfSubsidiariesAndAffiliatesNCL?: number;

    /**
     * 事業整理損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnBusinessLiquidationNCL?: number;

    /**
     * 関係会社事業損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnBusinessOfSubsidiariesAndAffiliatesNCL?: number;

    /**
     * 事業構造改善引当金
     * Namespace: jppfs_cor
     */
    ProvisionForBusinessStructureImprovementNCL?: number;

    /**
     * 環境対策引当金
     * Namespace: jppfs_cor
     */
    ProvisionForEnvironmentalMeasuresNCL?: number;

    /**
     * 訴訟損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnLitigationNCL?: number;

    /**
     * 利息返還損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnInterestRepaymentNCL?: number;

    /**
     * 偶発損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForContingentLossNCL?: number;

    /**
     * 災害損失引当金
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnDisasterNCL?: number;

    /**
     * 株式給付引当金
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedRemunerationNCL?: number;

    /**
     * 役員株式給付引当金
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedRemunerationForDirectorsAndOtherOfficersNCL?: number;

    /**
     * 株式報酬引当金
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedPaymentsNCL?: number;

    /**
     * その他の引当金
     * Namespace: jppfs_cor
     */
    OtherProvisionNCL?: number;

    /**
     * 引当金
     * Namespace: jppfs_cor
     */
    ProvisionNCL?: number;

    /**
     * 退職給付に係る負債
     * Namespace: jppfs_cor
     */
    NetDefinedBenefitLiability?: number;

    /**
     * 負ののれん
     * Namespace: jppfs_cor
     */
    NegativeGoodwill?: number;

    /**
     * リース債務
     * Namespace: jppfs_cor
     */
    LeaseObligationsNCL?: number;

    /**
     * 資産除去債務
     * Namespace: jppfs_cor
     */
    AssetRetirementObligationsNCL?: number;

    /**
     * 公共施設等運営権に係る負債
     * Namespace: jppfs_cor
     */
    LiabilitiesRelatedToRightToOperatePublicFacilitiesNCL?: number;

    /**
     * その他の負債で流動負債に属しないもの
     * Namespace: jppfs_cor
     */
    OtherLiabilitiesNotCurrentLiabilitiesNCLAbstract?: string;

    /**
     * 受入保証金
     * Namespace: jppfs_cor
     */
    GuaranteeDepositsReceivedNCL?: number;

    /**
     * 預り保証金
     * Namespace: jppfs_cor
     */
    GuaranteeDepositsReceived2NCL?: number;

    /**
     * 長期預り金
     * Namespace: jppfs_cor
     */
    LongTermDepositsReceived?: number;

    /**
     * 会員預り金
     * Namespace: jppfs_cor
     */
    DepositsReceivedFromMembers?: number;

    /**
     * 長期割賦未払金
     * Namespace: jppfs_cor
     */
    LongTermAccountsPayableInstallmentPurchase?: number;

    /**
     * 受入敷金保証金
     * Namespace: jppfs_cor
     */
    LeaseAndGuaranteeDepositsReceived?: number;

    /**
     * 長期設備関係支払手形
     * Namespace: jppfs_cor
     */
    LongTermNotesPayableFacilities?: number;

    /**
     * 長期設備関係未払金
     * Namespace: jppfs_cor
     */
    LongTermAccountsPayableFacilities?: number;

    /**
     * 長期前受金
     * Namespace: jppfs_cor
     */
    LongTermAdvancesReceived?: number;

    /**
     * 長期前受工事負担金
     * Namespace: jppfs_cor
     */
    LongTermDeferredContributionForConstruction?: number;

    /**
     * 長期預り敷金
     * Namespace: jppfs_cor
     */
    LongTermLeaseDeposited?: number;

    /**
     * 長期預り敷金保証金
     * Namespace: jppfs_cor
     */
    LongTermLeaseAndGuaranteeDeposited?: number;

    /**
     * 長期預り保証金
     * Namespace: jppfs_cor
     */
    LongTermGuaranteeDeposited?: number;

    /**
     * 保険契約準備金
     * Namespace: jppfs_cor
     */
    ReserveForContractOfInsurance?: number;

    /**
     * 長期未払金
     * Namespace: jppfs_cor
     */
    LongTermAccountsPayableOther?: number;

    /**
     * 長期前受収益
     * Namespace: jppfs_cor
     */
    LongTermUnearnedRevenue?: number;

    /**
     * デリバティブ債務
     * Namespace: jppfs_cor
     */
    DerivativesLiabilitiesNCL?: number;

    /**
     * 為替予約
     * Namespace: jppfs_cor
     */
    ForwardExchangeContractsNCL?: number;

    /**
     * 金利スワップ負債
     * Namespace: jppfs_cor
     */
    InterestRateSwapLiabilitiesNCL?: number;

    /**
     * 金利スワップ
     * Namespace: jppfs_cor
     */
    InterestRateSwapNCL?: number;

    /**
     * 売建通貨オプション
     * Namespace: jppfs_cor
     */
    SoldCurrencyOptionNCL?: number;

    /**
     * 通貨オプション
     * Namespace: jppfs_cor
     */
    CurrencyOptionNCL?: number;

    /**
     * 長期リース資産減損勘定
     * Namespace: jppfs_cor
     */
    AccumulatedImpairmentLossOnLongTermLeasedAssetsNCL?: number;

    /**
     * 繰延税金負債
     * Namespace: jppfs_cor
     */
    DeferredTaxLiabilities?: number;

    /**
     * 再評価に係る繰延税金負債
     * Namespace: jppfs_cor
     */
    DeferredTaxLiabilitiesForLandRevaluation?: number;

    /**
     * 持分法適用に伴う負債
     * Namespace: jppfs_cor
     */
    LiabilitiesFromApplicationOfEquityMethodNCL?: number;

    /**
     * 企業結合に係る特定勘定
     * Namespace: jppfs_cor
     */
    ProvisionIncurredFromABusinessCombinationNCL?: number;

    /**
     * 組織再編により生じた株式の特別勘定
     * Namespace: jppfs_cor
     */
    StockSpecialAccountCausedByRestructuringNCL?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherNCL?: number;

    /**
     * 固定負債
     * Namespace: jppfs_cor
     */
    NoncurrentLiabilities?: number;

    /**
     * 特別法上の準備金
     * Namespace: jppfs_cor
     */
    ReservesUnderTheSpecialLawsAbstract1?: string;

    /**
     * 特別法上の準備金
     * Namespace: jppfs_cor
     */
    ReservesUnderTheSpecialLaws1?: number;

    /**
     * 特別法上の引当金
     * Namespace: jppfs_cor
     */
    ReservesUnderTheSpecialLawsAbstract2?: string;

    /**
     * 特別法上の引当金
     * Namespace: jppfs_cor
     */
    ReservesUnderTheSpecialLaws2?: number;

    /**
     * 負債
     * Namespace: jppfs_cor
     */
    Liabilities?: number;

    /**
     * 純資産の部
     * Namespace: jppfs_cor
     */
    NetAssetsAbstract?: string;

    /**
     * 株主資本
     * Namespace: jppfs_cor
     */
    ShareholdersEquityAbstract?: string;

    /**
     * 資本金
     * Namespace: jppfs_cor
     */
    CapitalStock?: number;

    /**
     * 新株式申込証拠金
     * Namespace: jppfs_cor
     */
    DepositForSubscriptionsToShares?: number;

    /**
     * 資本剰余金
     * Namespace: jppfs_cor
     */
    CapitalSurplusAbstract?: string;

    /**
     * 資本準備金
     * Namespace: jppfs_cor
     */
    LegalCapitalSurplus?: number;

    /**
     * その他資本剰余金
     * Namespace: jppfs_cor
     */
    OtherCapitalSurplus?: number;

    /**
     * 資本剰余金
     * Namespace: jppfs_cor
     */
    CapitalSurplus?: number;

    /**
     * 利益剰余金
     * Namespace: jppfs_cor
     */
    RetainedEarningsAbstract?: string;

    /**
     * 利益準備金
     * Namespace: jppfs_cor
     */
    LegalRetainedEarnings?: number;

    /**
     * その他利益剰余金
     * Namespace: jppfs_cor
     */
    OtherRetainedEarningsAbstract?: string;

    /**
     * 減債積立金
     * Namespace: jppfs_cor
     */
    ReserveForBondSinkingFund?: number;

    /**
     * 中間配当積立金
     * Namespace: jppfs_cor
     */
    ReserveForInterimDividends?: number;

    /**
     * 配当平均積立金
     * Namespace: jppfs_cor
     */
    ReserveForDividendEqualization?: number;

    /**
     * 事業拡張積立金
     * Namespace: jppfs_cor
     */
    ReserveForBusinessExpansion?: number;

    /**
     * 自家保険積立金
     * Namespace: jppfs_cor
     */
    ReserveForPrivateInsurance?: number;

    /**
     * 固定資産圧縮積立金
     * Namespace: jppfs_cor
     */
    ReserveForAdvancedDepreciationOfNoncurrentAssets?: number;

    /**
     * 固定資産圧縮特別勘定積立金
     * Namespace: jppfs_cor
     */
    ReserveForSpecialAccountForAdvancedDepreciationOfNoncurrentAssets?: number;

    /**
     * 特別償却準備金
     * Namespace: jppfs_cor
     */
    ReserveForSpecialDepreciation?: number;

    /**
     * 海外投資等損失準備金
     * Namespace: jppfs_cor
     */
    ReserveForOverseasInvestmentLoss?: number;

    /**
     * 研究開発積立金
     * Namespace: jppfs_cor
     */
    ReserveForResearchAndDevelopment?: number;

    /**
     * 配当積立金
     * Namespace: jppfs_cor
     */
    ReserveForDividends1?: number;

    /**
     * 配当準備金
     * Namespace: jppfs_cor
     */
    ReserveForDividends2?: number;

    /**
     * 配当準備積立金
     * Namespace: jppfs_cor
     */
    ReserveForDividends3?: number;

    /**
     * 配当引当積立金
     * Namespace: jppfs_cor
     */
    ReserveForDividends4?: number;

    /**
     * 退職給与積立金
     * Namespace: jppfs_cor
     */
    ReserveForRetirementAllowance1?: number;

    /**
     * 退職積立金
     * Namespace: jppfs_cor
     */
    ReserveForRetirementAllowance2?: number;

    /**
     * 退職手当積立金
     * Namespace: jppfs_cor
     */
    ReserveForRetirementAllowance3?: number;

    /**
     * 退職慰労積立金
     * Namespace: jppfs_cor
     */
    ReserveForRetirementAllowance4?: number;

    /**
     * 役員退職積立金
     * Namespace: jppfs_cor
     */
    ReserveForDirectorsRetirementAllowance?: number;

    /**
     * 圧縮記帳積立金
     * Namespace: jppfs_cor
     */
    ReserveForReductionEntry1?: number;

    /**
     * 圧縮積立金
     * Namespace: jppfs_cor
     */
    ReserveForReductionEntry2?: number;

    /**
     * 土地圧縮積立金
     * Namespace: jppfs_cor
     */
    ReserveForReductionEntryOfLand?: number;

    /**
     * 建物圧縮積立金
     * Namespace: jppfs_cor
     */
    ReserveForReductionEntryOfBuildings?: number;

    /**
     * 不動産圧縮積立金
     * Namespace: jppfs_cor
     */
    ReserveForReductionEntryOfRealEstate?: number;

    /**
     * 資産圧縮積立金
     * Namespace: jppfs_cor
     */
    ReserveForReductionEntryOfAssets?: number;

    /**
     * 償却資産圧縮積立金
     * Namespace: jppfs_cor
     */
    ReserveForReductionEntryOfDepreciableAssets?: number;

    /**
     * 買換資産圧縮積立金
     * Namespace: jppfs_cor
     */
    ReserveForReductionEntryOfReplacedProperty?: number;

    /**
     * 買換資産積立金
     * Namespace: jppfs_cor
     */
    ReserveForPropertyReplacement?: number;

    /**
     * 特別償却積立金
     * Namespace: jppfs_cor
     */
    ReserveForSpecialDepreciationGeneral?: number;

    /**
     * 特別積立金
     * Namespace: jppfs_cor
     */
    SpecialReserve?: number;

    /**
     * 任意積立金
     * Namespace: jppfs_cor
     */
    VoluntaryRetainedEarnings?: number;

    /**
     * 別途積立金
     * Namespace: jppfs_cor
     */
    GeneralReserve?: number;

    /**
     * 繰越利益剰余金
     * Namespace: jppfs_cor
     */
    RetainedEarningsBroughtForward?: number;

    /**
     * その他利益剰余金
     * Namespace: jppfs_cor
     */
    OtherRetainedEarnings?: number;

    /**
     * 利益剰余金
     * Namespace: jppfs_cor
     */
    RetainedEarnings?: number;

    /**
     * 自己株式
     * Namespace: jppfs_cor
     */
    TreasuryStock?: number;

    /**
     * 自己株式申込証拠金
     * Namespace: jppfs_cor
     */
    DepositForSubscriptionsToTreasuryStock?: number;

    /**
     * 株主資本
     * Namespace: jppfs_cor
     */
    ShareholdersEquity?: number;

    /**
     * 評価・換算差額等
     * Namespace: jppfs_cor
     */
    ValuationAndTranslationAdjustmentsAbstract?: string;

    /**
     * その他有価証券評価差額金
     * Namespace: jppfs_cor
     */
    ValuationDifferenceOnAvailableForSaleSecurities?: number;

    /**
     * 繰延ヘッジ損益
     * Namespace: jppfs_cor
     */
    DeferredGainsOrLossesOnHedges?: number;

    /**
     * 土地再評価差額金
     * Namespace: jppfs_cor
     */
    RevaluationReserveForLand?: number;

    /**
     * 為替換算調整勘定
     * Namespace: jppfs_cor
     */
    ForeignCurrencyTranslationAdjustment?: number;

    /**
     * 退職給付に係る調整累計額
     * Namespace: jppfs_cor
     */
    RemeasurementsOfDefinedBenefitPlans?: number;

    /**
     * 評価・換算差額等
     * Namespace: jppfs_cor
     */
    ValuationAndTranslationAdjustments?: number;

    /**
     * 株式引受権
     * Namespace: jppfs_cor
     */
    ShareAwardRights?: number;

    /**
     * 新株予約権
     * Namespace: jppfs_cor
     */
    SubscriptionRightsToShares?: number;

    /**
     * 自己新株予約権
     * Namespace: jppfs_cor
     */
    TreasurySubscriptionRightsToShares?: number;

    /**
     * 非支配株主持分
     * Namespace: jppfs_cor
     */
    NonControllingInterests?: number;

    /**
     * 純資産
     * Namespace: jppfs_cor
     */
    NetAssets?: number;

    /**
     * 負債純資産
     * Namespace: jppfs_cor
     */
    LiabilitiesAndNetAssets?: number;

    /**
     * 損益計算書
     * Namespace: jppfs_cor
     */
    StatementOfIncomeAbstract?: string;

    /**
     * 損益計算書
     * Namespace: jppfs_cor
     */
    StatementOfIncomeTable?: string;

    /**
     * 損益計算書
     * Namespace: jppfs_cor
     */
    StatementOfIncomeLineItems?: string;

    /**
     * 営業活動による収益
     * Namespace: jppfs_cor
     */
    RevenueFromOperatingActivitiesAbstract?: string;

    /**
     * 売上高
     * Namespace: jppfs_cor
     */
    NetSalesAbstract?: string;

    /**
     * 売上高
     * Namespace: jppfs_cor
     */
    NetSales?: number;

    /**
     * 顧客との契約から生じる収益
     * Namespace: jppfs_cor
     */
    RevenueFromContractsWithCustomers?: number;

    /**
     * それ以外の収益
     * Namespace: jppfs_cor
     */
    RevenueOtherThanThatFromContractsWithCustomers?: number;

    /**
     * 売上収益
     * Namespace: jppfs_cor
     */
    RevenueAbstract?: string;

    /**
     * 売上収益
     * Namespace: jppfs_cor
     */
    Revenue?: number;

    /**
     * 営業収益
     * Namespace: jppfs_cor
     */
    OperatingRevenue1Abstract?: string;

    /**
     * 営業収益
     * Namespace: jppfs_cor
     */
    OperatingRevenue1?: number;

    /**
     * 営業収入
     * Namespace: jppfs_cor
     */
    OperatingRevenue2Abstract?: string;

    /**
     * 営業収入
     * Namespace: jppfs_cor
     */
    OperatingRevenue2?: number;

    /**
     * 営業総収入
     * Namespace: jppfs_cor
     */
    GrossOperatingRevenue?: number;

    /**
     * 営業活動による収益の内訳
     * Namespace: jppfs_cor
     */
    RevenueFromOperatingActivitiesDetailAbstract?: string;

    /**
     * 総売上高
     * Namespace: jppfs_cor
     */
    GrossSalesRevOA?: number;

    /**
     * 売上値引及び戻り高
     * Namespace: jppfs_cor
     */
    SalesAllowanceAndReturnsRevOA?: number;

    /**
     * 商品売上高
     * Namespace: jppfs_cor
     */
    NetSalesOfGoodsRevOA?: number;

    /**
     * 製品売上高
     * Namespace: jppfs_cor
     */
    NetSalesOfFinishedGoodsRevOA?: number;

    /**
     * 商品及び製品売上高
     * Namespace: jppfs_cor
     */
    NetSalesOfMerchandiseAndFinishedGoodsRevOA?: number;

    /**
     * 半製品売上高
     * Namespace: jppfs_cor
     */
    SalesOfSemiFinishedGoodsRevOA?: number;

    /**
     * 作業くず売上高
     * Namespace: jppfs_cor
     */
    SalesOfScrapsRevOA?: number;

    /**
     * 役務収益
     * Namespace: jppfs_cor
     */
    ServiceRevenueRevOA?: number;

    /**
     * サービス売上高
     * Namespace: jppfs_cor
     */
    ServiceSalesRevOA?: number;

    /**
     * 不動産売上高
     * Namespace: jppfs_cor
     */
    RealEstateSalesRevOA?: number;

    /**
     * 開発事業売上高
     * Namespace: jppfs_cor
     */
    SalesOnDevelopmentBusinessRevOA?: number;

    /**
     * 不動産事業売上高
     * Namespace: jppfs_cor
     */
    SalesOnRealEstateBusinessRevOA?: number;

    /**
     * 賃貸事業売上高
     * Namespace: jppfs_cor
     */
    SalesOnLeaseBusinessRevOA?: number;

    /**
     * 分譲事業売上高
     * Namespace: jppfs_cor
     */
    SalesOnSellingBusinessRevOA?: number;

    /**
     * その他の事業売上高
     * Namespace: jppfs_cor
     */
    SalesOnOtherBusinessRevOA?: number;

    /**
     * 賃貸事業収益
     * Namespace: jppfs_cor
     */
    LeaseBusinessRevenueRevOA?: number;

    /**
     * 賃貸事業収入
     * Namespace: jppfs_cor
     */
    LeaseBusinessRevenueSpecificRevOA?: number;

    /**
     * 賃貸収入
     * Namespace: jppfs_cor
     */
    RentIncomeRevOA?: number;

    /**
     * 不動産賃貸収入
     * Namespace: jppfs_cor
     */
    RentIncomeOfRealEstateRevOA?: number;

    /**
     * 不動産収入
     * Namespace: jppfs_cor
     */
    RealEstateIncomeRevOA?: number;

    /**
     * 手数料収入
     * Namespace: jppfs_cor
     */
    CommissionIncomeRevOA?: number;

    /**
     * 加工料収入
     * Namespace: jppfs_cor
     */
    ProcessingIncomeRevOA?: number;

    /**
     * ロイヤリティー収入
     * Namespace: jppfs_cor
     */
    RoyaltyIncomeRevOA?: number;

    /**
     * コンサルティング収入
     * Namespace: jppfs_cor
     */
    ConsultingIncomeRevOA?: number;

    /**
     * 加盟店からの収入
     * Namespace: jppfs_cor
     */
    IncomeFromFranchisedStoresRevOA?: number;

    /**
     * 関係会社受取配当金
     * Namespace: jppfs_cor
     */
    DividendsFromSubsidiariesAndAffiliatesRevOA?: number;

    /**
     * 受取配当金
     * Namespace: jppfs_cor
     */
    DividendsIncomeRevOA?: number;

    /**
     * 関係会社受入手数料
     * Namespace: jppfs_cor
     */
    CommissionsFromSubsidiariesAndAffiliatesRevOA?: number;

    /**
     * 関係会社貸付金利息
     * Namespace: jppfs_cor
     */
    InterestOnLoansToSubsidiariesAndAffiliatesRevOA?: number;

    /**
     * 経営管理料
     * Namespace: jppfs_cor
     */
    ManagementFeeIncomeRevOA?: number;

    /**
     * 経営指導料
     * Namespace: jppfs_cor
     */
    ConsultingFeeIncomeRevOA?: number;

    /**
     * 商標使用料
     * Namespace: jppfs_cor
     */
    TrademarkFeeIncomeRevOA?: number;

    /**
     * 資産利用料
     * Namespace: jppfs_cor
     */
    AssetRentalIncomeRevOA?: number;

    /**
     * 完成業務高
     * Namespace: jppfs_cor
     */
    ContractsCompletedRevOA?: number;

    /**
     * 工事売上高
     * Namespace: jppfs_cor
     */
    ConstructionSalesRevOA?: number;

    /**
     * ソフトウエア開発売上高
     * Namespace: jppfs_cor
     */
    SalesOfSoftwareDevelopmentRevOA?: number;

    /**
     * 情報サービス売上高
     * Namespace: jppfs_cor
     */
    SalesOfInformationServiceRevOA?: number;

    /**
     * 保守売上高
     * Namespace: jppfs_cor
     */
    SalesOfMaintenanceServiceRevOA?: number;

    /**
     * 年会費収入
     * Namespace: jppfs_cor
     */
    AnnualFeeIncomeRevOA?: number;

    /**
     * 倉庫収入
     * Namespace: jppfs_cor
     */
    WarehouseIncomeRevOA?: number;

    /**
     * 倉庫保管料
     * Namespace: jppfs_cor
     */
    WarehousingFeeIncomeRevOA?: number;

    /**
     * 倉庫荷役料
     * Namespace: jppfs_cor
     */
    StevedoringIncomeRevOA?: number;

    /**
     * 運送収入
     * Namespace: jppfs_cor
     */
    TransportationIncomeRevOA?: number;

    /**
     * 運送雑収
     * Namespace: jppfs_cor
     */
    MiscellaneousTransportationIncomeRevOA?: number;

    /**
     * 制作収入
     * Namespace: jppfs_cor
     */
    ProductionIncomeRevOA?: number;

    /**
     * 放送収入
     * Namespace: jppfs_cor
     */
    IncomeFromBroadcastingBusinessRevOA?: number;

    /**
     * テレビ収入
     * Namespace: jppfs_cor
     */
    IncomeFromTelevisionBusinessRevOA?: number;

    /**
     * ラジオ収入
     * Namespace: jppfs_cor
     */
    IncomeFromRadioBusinessRevOA?: number;

    /**
     * レンタル売上高
     * Namespace: jppfs_cor
     */
    RentalSalesRevOA?: number;

    /**
     * 受託品売上高
     * Namespace: jppfs_cor
     */
    SalesOfGoodsOnConsignmentRevOA?: number;

    /**
     * 買付品売上高
     * Namespace: jppfs_cor
     */
    IndentSalesRevOA?: number;

    /**
     * その他の売上高
     * Namespace: jppfs_cor
     */
    OtherSalesRevOA?: number;

    /**
     * その他の事業収益
     * Namespace: jppfs_cor
     */
    OtherBusinessRevenue1RevOA?: number;

    /**
     * その他の事業収入
     * Namespace: jppfs_cor
     */
    OtherBusinessRevenue2RevOA?: number;

    /**
     * その他の営業収益
     * Namespace: jppfs_cor
     */
    OtherOperatingRevenue1RevOA?: number;

    /**
     * その他の営業収入
     * Namespace: jppfs_cor
     */
    OtherOperatingRevenue2RevOA?: number;

    /**
     * その他の収益
     * Namespace: jppfs_cor
     */
    OtherRevenue1RevOA?: number;

    /**
     * その他の収入
     * Namespace: jppfs_cor
     */
    OtherRevenue2RevOA?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherRevOA?: number;

    /**
     * 金融収益
     * Namespace: jppfs_cor
     */
    FinancialRevenueAbstract?: string;

    /**
     * 金融収益
     * Namespace: jppfs_cor
     */
    FinancialRevenue?: number;

    /**
     * 融資収益
     * Namespace: jppfs_cor
     */
    FinancingRevenueRevOA?: number;

    /**
     * リース収益
     * Namespace: jppfs_cor
     */
    LeaseRevenueRevOA?: number;

    /**
     * 営業投資有価証券売上高
     * Namespace: jppfs_cor
     */
    RevenueFromOperationalInvestmentSecuritiesRevOA?: number;

    /**
     * 包括信用購入あっせん収益
     * Namespace: jppfs_cor
     */
    CreditCardRevenueRevOA?: number;

    /**
     * 個別信用購入あっせん収益
     * Namespace: jppfs_cor
     */
    PerItemRevenueRevOA?: number;

    /**
     * 信用保証収益
     * Namespace: jppfs_cor
     */
    RevenueFromCreditGuaranteeRevOA?: number;

    /**
     * 投資事業組合管理収入
     * Namespace: jppfs_cor
     */
    IncomeFromPartnershipManagementRevOA?: number;

    /**
     * 名義書換手数料
     * Namespace: jppfs_cor
     */
    NameTransferFeeRevOA?: number;

    /**
     * 買取債権回収高
     * Namespace: jppfs_cor
     */
    CollectionFromPurchasedReceivableRevOA?: number;

    /**
     * 借入有価証券代り金利息
     * Namespace: jppfs_cor
     */
    InterestOnCollateralMoneyForSecuritiesBorrowedRevOA?: number;

    /**
     * 有価証券貸付料
     * Namespace: jppfs_cor
     */
    ChargeOnSecuritiesLoanedRevOA?: number;

    /**
     * 投資収益
     * Namespace: jppfs_cor
     */
    GainOnInvestmentRevOA?: number;

    /**
     * その他の金融収益
     * Namespace: jppfs_cor
     */
    OtherFinancialRevenueRevOA?: number;

    /**
     * 営業活動による費用・売上原価
     * Namespace: jppfs_cor
     */
    COSAndExpensesFromOperatingActivitiesAbstract?: string;

    /**
     * 売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesAbstract?: string;

    /**
     * 売上原価
     * Namespace: jppfs_cor
     */
    CostOfSales?: number;

    /**
     * 営業費用
     * Namespace: jppfs_cor
     */
    OperatingExpensesAbstract?: string;

    /**
     * 営業費用
     * Namespace: jppfs_cor
     */
    OperatingExpenses?: number;

    /**
     * 営業原価
     * Namespace: jppfs_cor
     */
    OperatingCostAbstract?: string;

    /**
     * 営業原価
     * Namespace: jppfs_cor
     */
    OperatingCost?: number;

    /**
     * 営業活動による費用・売上原価の内訳
     * Namespace: jppfs_cor
     */
    COSAndExpensesFromOperatingActivitiesDetailAbstract?: string;

    /**
     * 商品売上原価
     * Namespace: jppfs_cor
     */
    CostOfGoodsSoldAbstract?: string;

    /**
     * 商品期首棚卸高
     * Namespace: jppfs_cor
     */
    BeginningGoodsCOS?: number;

    /**
     * 総仕入高
     * Namespace: jppfs_cor
     */
    TotalPurchaseOfGoods?: number;

    /**
     * 仕入値引及び戻し高
     * Namespace: jppfs_cor
     */
    PurchaseAllowanceAndReturns?: number;

    /**
     * 当期商品仕入高
     * Namespace: jppfs_cor
     */
    CostOfPurchasedGoods?: number;

    /**
     * 商品期末棚卸高
     * Namespace: jppfs_cor
     */
    EndingGoodsCOS?: number;

    /**
     * 合計
     * Namespace: jppfs_cor
     */
    TotalBeginningAndPurchaseOfGoods?: number;

    /**
     * 商品他勘定振替高
     * Namespace: jppfs_cor
     */
    GoodsTransferToOtherAccountCOS?: number;

    /**
     * 商品評価損
     * Namespace: jppfs_cor
     */
    ValuationLossOnGoodsCOS?: number;

    /**
     * 小計
     * Namespace: jppfs_cor
     */
    SubtotalCOSGoods?: number;

    /**
     * 差引
     * Namespace: jppfs_cor
     */
    NetCOSGoods?: number;

    /**
     * 商品売上原価
     * Namespace: jppfs_cor
     */
    CostOfGoodsSold?: number;

    /**
     * 製品売上原価
     * Namespace: jppfs_cor
     */
    CostOfFinishedGoodsSoldAbstract?: string;

    /**
     * 製品期首棚卸高
     * Namespace: jppfs_cor
     */
    BeginningFinishedGoodsCOS?: number;

    /**
     * 当期製品製造原価
     * Namespace: jppfs_cor
     */
    CostOfProductsManufactured?: number;

    /**
     * 当期製品仕入高
     * Namespace: jppfs_cor
     */
    PurchaseOfFinishedGoodsCOS?: number;

    /**
     * 製品期末棚卸高
     * Namespace: jppfs_cor
     */
    EndingFinishedGoodsCOS?: number;

    /**
     * 合計
     * Namespace: jppfs_cor
     */
    TotalBeginningFinishedGoodsAndCostOfProductsManufacturedForThePeriod?: number;

    /**
     * 製品他勘定振替高
     * Namespace: jppfs_cor
     */
    FinishedGoodsTransferToOtherAccountCOS?: number;

    /**
     * 製品評価損
     * Namespace: jppfs_cor
     */
    ValuationLossOnFinishedGoodsCOS?: number;

    /**
     * 原材料評価損
     * Namespace: jppfs_cor
     */
    ValuationLossOnRawMaterialsCOS?: number;

    /**
     * 小計
     * Namespace: jppfs_cor
     */
    SubtotalCOSFinishedGoods?: number;

    /**
     * 差引
     * Namespace: jppfs_cor
     */
    NetCOSFinishedGoods?: number;

    /**
     * 製品売上原価
     * Namespace: jppfs_cor
     */
    CostOfFinishedGoodsSold?: number;

    /**
     * 他勘定振替高
     * Namespace: jppfs_cor
     */
    TransferToOtherAccountCOS?: number;

    /**
     * 他勘定受入高
     * Namespace: jppfs_cor
     */
    TransferFromOtherAccountCOS?: number;

    /**
     * 合併による商品受入高
     * Namespace: jppfs_cor
     */
    TransferOfGoodsByMergerCOS?: number;

    /**
     * 原価差額
     * Namespace: jppfs_cor
     */
    CostPriceBalanceCOS?: number;

    /**
     * 商品及び製品売上原価
     * Namespace: jppfs_cor
     */
    CostOfMerchandiseAndFinishedGoodsSoldCOS?: number;

    /**
     * 商品及び製品期首棚卸高
     * Namespace: jppfs_cor
     */
    BeginningMerchandiseAndFinishedGoodsCOS?: number;

    /**
     * 当期商品及び製品仕入高
     * Namespace: jppfs_cor
     */
    CostOfPurchasedMerchandiseAndFinishedGoodsCOS?: number;

    /**
     * 合計
     * Namespace: jppfs_cor
     */
    TotalBeginningAndCostPurchasedMerchandiseAndFinishedGoodsCOS?: number;

    /**
     * 商品及び製品期末棚卸高
     * Namespace: jppfs_cor
     */
    EndingMerchandiseAndFinishedGoodsCOS?: number;

    /**
     * 原材料売上原価
     * Namespace: jppfs_cor
     */
    CostOfRawMaterialSalesCOSExpOA?: number;

    /**
     * サービス売上原価
     * Namespace: jppfs_cor
     */
    CostOfServiceSalesCOSExpOA?: number;

    /**
     * 不動産売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesRealEstateCOSExpOA?: number;

    /**
     * 開発事業売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOnDevelopmentBusinessCOSExpOA?: number;

    /**
     * 不動産事業売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOnRealEstateBusinessCOSExpOA?: number;

    /**
     * 賃貸事業売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOnLeaseBusinessCOSExpOA?: number;

    /**
     * 分譲事業売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOnSellingBusinessCOSExpOA?: number;

    /**
     * その他の事業売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOnOtherBusinessCOSExpOA?: number;

    /**
     * 工事売上原価
     * Namespace: jppfs_cor
     */
    CostOfConstructionSalesCOSExpOA?: number;

    /**
     * ソフトウエア開発売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOfSoftwareDevelopmentCOSExpOA?: number;

    /**
     * 情報サービス売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOfInformationServiceCOSExpOA?: number;

    /**
     * 保守売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOfMaintenanceServiceCOSExpOA?: number;

    /**
     * 受託品売上原価
     * Namespace: jppfs_cor
     */
    CostOfSalesOfGoodsOnConsignmentCOSExpOA?: number;

    /**
     * 買付品売上原価
     * Namespace: jppfs_cor
     */
    CostOfIndentSalesCOSExpOA?: number;

    /**
     * 完成業務原価
     * Namespace: jppfs_cor
     */
    CostOfCompletedWorkCOSExpOA?: number;

    /**
     * 賃貸原価
     * Namespace: jppfs_cor
     */
    RentCostCOSExpOA?: number;

    /**
     * 不動産賃貸原価
     * Namespace: jppfs_cor
     */
    CostOfRealEstateRentCOSExpOA?: number;

    /**
     * 不動産賃貸費用
     * Namespace: jppfs_cor
     */
    ExpensesOfRealEstateRentCOSExpOA?: number;

    /**
     * 賃貸事業原価
     * Namespace: jppfs_cor
     */
    LeaseBusinessCostCOSExpOA?: number;

    /**
     * 分譲事業原価
     * Namespace: jppfs_cor
     */
    SellingBusinessCostCOSExpOA?: number;

    /**
     * その他の事業原価
     * Namespace: jppfs_cor
     */
    OtherBusinessCostCOSExpOA?: number;

    /**
     * ソフトウエア償却費
     * Namespace: jppfs_cor
     */
    AmortizationOfSoftwareCOSExpOA?: number;

    /**
     * 維持運転費
     * Namespace: jppfs_cor
     */
    MaintenanceAndOperatingExpensesCOSExpOA?: number;

    /**
     * 番組費
     * Namespace: jppfs_cor
     */
    ProgramExpensesCOSExpOA?: number;

    /**
     * 放送費
     * Namespace: jppfs_cor
     */
    BroadcastingExpensesCOSExpOA?: number;

    /**
     * その他の事業費用
     * Namespace: jppfs_cor
     */
    OtherBusinessExpensesCOSExpOA?: number;

    /**
     * その他の原価
     * Namespace: jppfs_cor
     */
    OtherCostCOSExpOA?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherCOSExpOA?: number;

    /**
     * 金融費用
     * Namespace: jppfs_cor
     */
    FinancialExpensesAbstract?: string;

    /**
     * 金融費用
     * Namespace: jppfs_cor
     */
    FinancialExpenses?: number;

    /**
     * 営業投資有価証券売上原価
     * Namespace: jppfs_cor
     */
    CostOfOperationalInvestmentSecuritiesCOSExpOA?: number;

    /**
     * 借入金利息
     * Namespace: jppfs_cor
     */
    InterestOnLoansCOSExpOA?: number;

    /**
     * 有価証券借入料
     * Namespace: jppfs_cor
     */
    BorrowingFeeOnSecuritiesCOSExpOA?: number;

    /**
     * 債権買取原価
     * Namespace: jppfs_cor
     */
    CostOfPurchasedReceivableCOSExpOA?: number;

    /**
     * その他の金融費用
     * Namespace: jppfs_cor
     */
    OtherFinancialExpensesCOSExpOA?: number;

    /**
     * 販売費及び一般管理費
     * Namespace: jppfs_cor
     */
    SellingGeneralAndAdministrativeExpensesAbstract?: string;

    /**
     * 販売手数料
     * Namespace: jppfs_cor
     */
    SalesCommissionSGA?: number;

    /**
     * 荷造費
     * Namespace: jppfs_cor
     */
    PackingExpensesSGA?: number;

    /**
     * 運搬費
     * Namespace: jppfs_cor
     */
    HaulageExpensesSGA?: number;

    /**
     * 広告宣伝費
     * Namespace: jppfs_cor
     */
    AdvertisingExpensesSGA?: number;

    /**
     * 見本費
     * Namespace: jppfs_cor
     */
    SampleExpensesSGA?: number;

    /**
     * 保管費
     * Namespace: jppfs_cor
     */
    WarehousingExpensesSGA?: number;

    /**
     * 納入試験費
     * Namespace: jppfs_cor
     */
    DeliveryExaminationExpensesSGA?: number;

    /**
     * 役員報酬
     * Namespace: jppfs_cor
     */
    DirectorsCompensationsSGA?: number;

    /**
     * 給料
     * Namespace: jppfs_cor
     */
    SalariesSGA?: number;

    /**
     * 賃金
     * Namespace: jppfs_cor
     */
    WagesSGA?: number;

    /**
     * 手当
     * Namespace: jppfs_cor
     */
    AllowanceSGA?: number;

    /**
     * 賞与
     * Namespace: jppfs_cor
     */
    BonusesSGA?: number;

    /**
     * 福利厚生費
     * Namespace: jppfs_cor
     */
    WelfareExpensesSGA?: number;

    /**
     * 交際費
     * Namespace: jppfs_cor
     */
    EntertainmentExpensesSGA?: number;

    /**
     * 旅費
     * Namespace: jppfs_cor
     */
    TravelingExpensesSGA?: number;

    /**
     * 交通費
     * Namespace: jppfs_cor
     */
    TransportationExpensesSGA?: number;

    /**
     * 通信費
     * Namespace: jppfs_cor
     */
    CommunicationExpensesSGA?: number;

    /**
     * 光熱費
     * Namespace: jppfs_cor
     */
    HeatingAndLightingExpensesSGA?: number;

    /**
     * 消耗品費
     * Namespace: jppfs_cor
     */
    SuppliesExpensesSGA?: number;

    /**
     * 租税公課
     * Namespace: jppfs_cor
     */
    TaxesAndDuesSGA?: number;

    /**
     * 減価償却費
     * Namespace: jppfs_cor
     */
    DepreciationSGA?: number;

    /**
     * 修繕費
     * Namespace: jppfs_cor
     */
    RepairExpensesSGA?: number;

    /**
     * 保険料
     * Namespace: jppfs_cor
     */
    InsuranceExpensesSGA?: number;

    /**
     * 不動産賃借料
     * Namespace: jppfs_cor
     */
    RentExpensesOnRealEstatesSGA?: number;

    /**
     * 貸倒引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionOfAllowanceForDoubtfulAccountsSGA?: number;

    /**
     * 貸倒損失
     * Namespace: jppfs_cor
     */
    BadDebtsExpensesSGA?: number;

    /**
     * 賞与引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForBonusesSGA?: number;

    /**
     * 役員退職慰労引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForDirectorsRetirementBenefitsSGA?: number;

    /**
     * 役員賞与引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForDirectorsBonusesSGA?: number;

    /**
     * 退職給付費用
     * Namespace: jppfs_cor
     */
    RetirementBenefitExpensesSGA?: number;

    /**
     * 研究開発費
     * Namespace: jppfs_cor
     */
    ResearchAndDevelopmentExpensesSGA?: number;

    /**
     * 人件費
     * Namespace: jppfs_cor
     */
    PersonalExpensesSGA?: number;

    /**
     * 給料及び手当
     * Namespace: jppfs_cor
     */
    SalariesAndAllowancesSGA?: number;

    /**
     * 給料及び賞与
     * Namespace: jppfs_cor
     */
    SalariesAndBonusesSGA?: number;

    /**
     * 給料手当及び賞与
     * Namespace: jppfs_cor
     */
    SalariesAllowancesAndBonusesSGA?: number;

    /**
     * 給料手当及び福利費
     * Namespace: jppfs_cor
     */
    SalariesAndAllowancesAndWelfareExpensesSGA?: number;

    /**
     * 給料及び賃金
     * Namespace: jppfs_cor
     */
    SalariesAndWagesSGA?: number;

    /**
     * 給与手当
     * Namespace: jppfs_cor
     */
    PayrollAndAllowancesSGA?: number;

    /**
     * 賞与及び手当
     * Namespace: jppfs_cor
     */
    BonusesAndAllowanceSGA?: number;

    /**
     * 従業員給料
     * Namespace: jppfs_cor
     */
    EmployeesSalariesSGA?: number;

    /**
     * 従業員賞与
     * Namespace: jppfs_cor
     */
    EmployeesBonusesSGA?: number;

    /**
     * 従業員給料及び賞与
     * Namespace: jppfs_cor
     */
    EmployeesSalariesAndBonusesSGA?: number;

    /**
     * 従業員給料及び手当
     * Namespace: jppfs_cor
     */
    EmployeesSalariesAndAllowancesSGA?: number;

    /**
     * 報酬及び給料手当
     * Namespace: jppfs_cor
     */
    CompensationsSalariesAndAllowancesSGA?: number;

    /**
     * 役員報酬及び給料手当
     * Namespace: jppfs_cor
     */
    DirectorsCompensationsSalariesAndAllowancesSGA?: number;

    /**
     * 退職金
     * Namespace: jppfs_cor
     */
    RetirementPaymentsSGA?: number;

    /**
     * 退職給付引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForRetirementBenefitsSGA?: number;

    /**
     * 役員退職慰労金
     * Namespace: jppfs_cor
     */
    DirectorsRetirementBenefitsSGA?: number;

    /**
     * 雑給
     * Namespace: jppfs_cor
     */
    OtherSalariesSGA?: number;

    /**
     * 法定福利及び厚生費
     * Namespace: jppfs_cor
     */
    LegalAndEmployeeBenefitsExpensesSGA?: number;

    /**
     * 法定福利費
     * Namespace: jppfs_cor
     */
    LegalWelfareExpensesSGA?: number;

    /**
     * 株式報酬費用
     * Namespace: jppfs_cor
     */
    ShareBasedCompensationExpensesSGA?: number;

    /**
     * のれん償却額
     * Namespace: jppfs_cor
     */
    AmortizationOfGoodwillSGA?: number;

    /**
     * 株式交付費
     * Namespace: jppfs_cor
     */
    StockIssuanceCostSGA?: number;

    /**
     * 開業費償却
     * Namespace: jppfs_cor
     */
    AmortizationOfBusinessCommencementExpensesSGA?: number;

    /**
     * 開発費償却
     * Namespace: jppfs_cor
     */
    AmortizationOfDevelopmentExpensesSGA?: number;

    /**
     * 支払報酬
     * Namespace: jppfs_cor
     */
    CompensationsSGA?: number;

    /**
     * 顧問料
     * Namespace: jppfs_cor
     */
    ConsultingExpensesSGA?: number;

    /**
     * 教育研修費
     * Namespace: jppfs_cor
     */
    EducationAndTrainingExpensesSGA?: number;

    /**
     * 研修費
     * Namespace: jppfs_cor
     */
    TrainingExpensesSGA?: number;

    /**
     * 採用費
     * Namespace: jppfs_cor
     */
    RecruitingExpensesSGA?: number;

    /**
     * 募集費
     * Namespace: jppfs_cor
     */
    OfferingExpensesSGA?: number;

    /**
     * 外注費
     * Namespace: jppfs_cor
     */
    SubcontractExpensesSGA?: number;

    /**
     * 事務委託費
     * Namespace: jppfs_cor
     */
    OperationsConsignmentExpensesSGA?: number;

    /**
     * 業務委託費
     * Namespace: jppfs_cor
     */
    BusinessConsignmentExpensesSGA?: number;

    /**
     * 支払手数料
     * Namespace: jppfs_cor
     */
    CommissionFeeSGA?: number;

    /**
     * 賃借料
     * Namespace: jppfs_cor
     */
    RentExpensesSGA?: number;

    /**
     * 施設使用料
     * Namespace: jppfs_cor
     */
    FacilityExpensesSGA?: number;

    /**
     * 地代家賃
     * Namespace: jppfs_cor
     */
    RentsSGA?: number;

    /**
     * 借地借家料
     * Namespace: jppfs_cor
     */
    LeaseholdAndOfficeRentsSGA?: number;

    /**
     * 販売促進費
     * Namespace: jppfs_cor
     */
    PromotionExpensesSGA?: number;

    /**
     * 広告宣伝費及び販売促進費
     * Namespace: jppfs_cor
     */
    AdvertisingAndPromotionExpensesSGA?: number;

    /**
     * 事業宣伝費
     * Namespace: jppfs_cor
     */
    BusinessAdvertisingExpensesSGA?: number;

    /**
     * 代理店手数料
     * Namespace: jppfs_cor
     */
    AgentFeeSGA?: number;

    /**
     * 製品保証引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForProductWarrantiesSGA?: number;

    /**
     * 完成工事補償引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForWarrantiesForCompletedConstructionSGA?: number;

    /**
     * 特別修繕引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForSpecialRepairsSGA?: number;

    /**
     * ポイント引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForPointCardCertificatesSGA?: number;

    /**
     * 利息返還損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnInterestRepaymentSGA?: number;

    /**
     * 株式給付引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedRemunerationSGA?: number;

    /**
     * 役員株式給付引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedRemunerationForDirectorsAndOtherOfficersSGA?: number;

    /**
     * 株主優待引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForShareholderBenefitProgramSGA?: number;

    /**
     * 株式報酬引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForShareBasedPaymentsSGA?: number;

    /**
     * 運送費及び保管費
     * Namespace: jppfs_cor
     */
    TransportationAndWarehousingExpensesSGA?: number;

    /**
     * 運賃
     * Namespace: jppfs_cor
     */
    FreightageExpensesSGA?: number;

    /**
     * 運賃及び荷造費
     * Namespace: jppfs_cor
     */
    FreightageAndPackingExpensesSGA?: number;

    /**
     * 運賃諸掛
     * Namespace: jppfs_cor
     */
    FreightageRelatedExpensesSGA?: number;

    /**
     * 荷造運搬費
     * Namespace: jppfs_cor
     */
    PackingAndTransportationExpensesSGA?: number;

    /**
     * 荷造及び発送費
     * Namespace: jppfs_cor
     */
    PackingAndDeliveryExpensesSGA?: number;

    /**
     * 販売運賃
     * Namespace: jppfs_cor
     */
    SalesFareSGA?: number;

    /**
     * 発送運賃
     * Namespace: jppfs_cor
     */
    FreightOutSGA?: number;

    /**
     * 配送費
     * Namespace: jppfs_cor
     */
    DistributionExpensesSGA?: number;

    /**
     * 発送費
     * Namespace: jppfs_cor
     */
    ShipmentExpensesSGA?: number;

    /**
     * 試験研究費
     * Namespace: jppfs_cor
     */
    ExperimentAndResearchExpensesSGA?: number;

    /**
     * 開発研究費
     * Namespace: jppfs_cor
     */
    DevelopmentAndResearchExpensesSGA?: number;

    /**
     * 技術研究費
     * Namespace: jppfs_cor
     */
    TechnicalResearchExpensesSGA?: number;

    /**
     * 研究費
     * Namespace: jppfs_cor
     */
    ResearchExpensesSGA?: number;

    /**
     * 修繕維持費
     * Namespace: jppfs_cor
     */
    RepairAndMaintenanceSGA?: number;

    /**
     * 寄付金
     * Namespace: jppfs_cor
     */
    ContributionSGA?: number;

    /**
     * 特許権使用料
     * Namespace: jppfs_cor
     */
    LicenseFeeSGA?: number;

    /**
     * 長期前払費用償却
     * Namespace: jppfs_cor
     */
    AmortizationOfLongTermPrepaidExpensesSGA?: number;

    /**
     * 水道光熱費
     * Namespace: jppfs_cor
     */
    UtilitiesExpensesSGA?: number;

    /**
     * 動力用水光熱費
     * Namespace: jppfs_cor
     */
    PowerUtilitiesExpensesSGA?: number;

    /**
     * 衛生費
     * Namespace: jppfs_cor
     */
    MedicalExpensesSGA?: number;

    /**
     * 事業所税
     * Namespace: jppfs_cor
     */
    OfficeTaxesSGA?: number;

    /**
     * 事業税
     * Namespace: jppfs_cor
     */
    EnterpriseTaxSGA?: number;

    /**
     * 事務費
     * Namespace: jppfs_cor
     */
    OfficeCostSGA?: number;

    /**
     * 事務用品費
     * Namespace: jppfs_cor
     */
    StationeryExpensesSGA?: number;

    /**
     * 事務用消耗品費
     * Namespace: jppfs_cor
     */
    OfficeSuppliesExpensesSGA?: number;

    /**
     * 車両費
     * Namespace: jppfs_cor
     */
    VehicleExpensesSGA?: number;

    /**
     * 会議費
     * Namespace: jppfs_cor
     */
    ConferenceExpensesSGA?: number;

    /**
     * 諸会費
     * Namespace: jppfs_cor
     */
    MembershipFeeSGA?: number;

    /**
     * 諸経費
     * Namespace: jppfs_cor
     */
    SundryExpensesSGA?: number;

    /**
     * 図書費
     * Namespace: jppfs_cor
     */
    BookExpensesSGA?: number;

    /**
     * 印刷費
     * Namespace: jppfs_cor
     */
    PrintExpensesSGA?: number;

    /**
     * 図書印刷費
     * Namespace: jppfs_cor
     */
    BookAndPrintingExpensesSGA?: number;

    /**
     * 調査研究費
     * Namespace: jppfs_cor
     */
    ResearchStudyExpensesSGA?: number;

    /**
     * 調査費
     * Namespace: jppfs_cor
     */
    InvestigationExpensesSGA?: number;

    /**
     * 旅費交通費及び通信費
     * Namespace: jppfs_cor
     */
    TransportationAndCommunicationExpensesSGA?: number;

    /**
     * 旅費及び通信費
     * Namespace: jppfs_cor
     */
    TravelingAndCommunicationExpensesSGA?: number;

    /**
     * 旅費及び交通費
     * Namespace: jppfs_cor
     */
    TravelingAndTransportationExpensesSGA?: number;

    /**
     * 通信交通費
     * Namespace: jppfs_cor
     */
    CorrespondenceAndTransportationExpensesSGA?: number;

    /**
     * 取引関連費
     * Namespace: jppfs_cor
     */
    TradingRelatedExpensesSGA?: number;

    /**
     * 不動産関連費
     * Namespace: jppfs_cor
     */
    RealEstateRelatedExpensesSGA?: number;

    /**
     * 雑費
     * Namespace: jppfs_cor
     */
    MiscellaneousExpensesSGA?: number;

    /**
     * その他の販売費
     * Namespace: jppfs_cor
     */
    OtherSellingExpensesSGA?: number;

    /**
     * その他の一般管理費
     * Namespace: jppfs_cor
     */
    OtherGeneralAndAdministrativeExpensesSGA?: number;

    /**
     * その他の経費
     * Namespace: jppfs_cor
     */
    OtherExpensesSGA?: number;

    /**
     * その他の人件費
     * Namespace: jppfs_cor
     */
    OtherPersonalExpensesSGA?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherSGA?: number;

    /**
     * 販売費
     * Namespace: jppfs_cor
     */
    SellingExpensesSGAAbstract?: string;

    /**
     * 退職給付費用
     * Namespace: jppfs_cor
     */
    RetirementBenefitExpensesSellingExpenses?: number;

    /**
     * 減価償却費
     * Namespace: jppfs_cor
     */
    DepreciationSellingExpenses?: number;

    /**
     * 賞与引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForBonusesSellingExpenses?: number;

    /**
     * 販売費
     * Namespace: jppfs_cor
     */
    SellingExpensesSGA?: number;

    /**
     * 一般管理費
     * Namespace: jppfs_cor
     */
    GeneralAndAdministrativeExpensesSGAAbstract?: string;

    /**
     * 退職給付費用
     * Namespace: jppfs_cor
     */
    RetirementBenefitExpensesGA?: number;

    /**
     * 減価償却費
     * Namespace: jppfs_cor
     */
    DepreciationGA?: number;

    /**
     * 賞与引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForBonusesGA?: number;

    /**
     * 一般管理費
     * Namespace: jppfs_cor
     */
    GeneralAndAdministrativeExpensesSGA?: number;

    /**
     * 販売費及び一般管理費
     * Namespace: jppfs_cor
     */
    SellingGeneralAndAdministrativeExpenses?: number;

    /**
     * 売上総利益又は売上総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfit?: number;

    /**
     * 差引売上総利益又は差引売上総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfitNetGP?: number;

    /**
     * 割賦販売未実現利益繰入額
     * Namespace: jppfs_cor
     */
    ProvisionOfUnrealizedIncomeOnInstallmentSalesGP?: number;

    /**
     * 割賦販売未実現利益戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfUnrealizedIncomeOnInstallmentSalesGP?: number;

    /**
     * 返品調整引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForSalesReturnsGP?: number;

    /**
     * 返品調整引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForSalesReturnsGP?: number;

    /**
     * 商品売上総利益又は商品売上総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfitMerchandiseGP?: number;

    /**
     * 製品売上総利益又は製品売上総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfitFinishedGoodsGP?: number;

    /**
     * 不動産売上総利益又は不動産売上総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfitRealEstateSalesGP?: number;

    /**
     * 不動産事業総利益又は不動産事業総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfitRealEstateBusinessGP?: number;

    /**
     * 開発事業総利益又は開発事業総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfitDevelopingBusinessGP?: number;

    /**
     * その他の事業総利益又はその他の事業総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfitOtherBusinessGP?: number;

    /**
     * その他の売上総利益又はその他の売上総損失（△）
     * Namespace: jppfs_cor
     */
    GrossProfitOtherGP?: number;

    /**
     * 営業総利益又は営業総損失（△）
     * Namespace: jppfs_cor
     */
    OperatingGrossProfit?: number;

    /**
     * 営業利益又は営業損失（△）
     * Namespace: jppfs_cor
     */
    OperatingIncome?: number;

    /**
     * 全事業営業利益又は全事業営業損失（△）
     * Namespace: jppfs_cor
     */
    OperatingIncomeTotalBusiness?: number;

    /**
     * 営業外収益
     * Namespace: jppfs_cor
     */
    NonOperatingIncomeAbstract?: string;

    /**
     * 受取利息
     * Namespace: jppfs_cor
     */
    InterestIncomeNOI?: number;

    /**
     * 有価証券利息
     * Namespace: jppfs_cor
     */
    InterestOnSecuritiesNOI?: number;

    /**
     * 受取配当金
     * Namespace: jppfs_cor
     */
    DividendsIncomeNOI?: number;

    /**
     * 仕入割引
     * Namespace: jppfs_cor
     */
    PurchaseDiscountsNOI?: number;

    /**
     * 投資不動産賃貸料
     * Namespace: jppfs_cor
     */
    RentOfRealEstateForInvestmentNOI?: number;

    /**
     * 還付消費税等
     * Namespace: jppfs_cor
     */
    RefundedConsumptionTaxesNOI?: number;

    /**
     * 負ののれん償却額
     * Namespace: jppfs_cor
     */
    AmortizationOfNegativeGoodwillNOI?: number;

    /**
     * 持分法による投資利益
     * Namespace: jppfs_cor
     */
    EquityInEarningsOfAffiliatesNOI?: number;

    /**
     * 為替差益
     * Namespace: jppfs_cor
     */
    ForeignExchangeGainsNOI?: number;

    /**
     * 有価証券売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfSecuritiesNOI?: number;

    /**
     * 投資有価証券売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfInvestmentSecuritiesNOI?: number;

    /**
     * 投資有価証券評価益
     * Namespace: jppfs_cor
     */
    GainOnValuationOfInvestmentSecuritiesNOI?: number;

    /**
     * 未払配当金除斥益
     * Namespace: jppfs_cor
     */
    GainOnForfeitureOfUnclaimedDividendsNOI?: number;

    /**
     * 有価証券償還益
     * Namespace: jppfs_cor
     */
    GainOnRedemptionOfSecuritiesNOI?: number;

    /**
     * 有価証券運用益
     * Namespace: jppfs_cor
     */
    GainOnInvestmentOfSecuritiesNOI?: number;

    /**
     * 有価証券評価益
     * Namespace: jppfs_cor
     */
    GainOnValuationOfSecuritiesNOI?: number;

    /**
     * 投資有価証券評価損戻入益
     * Namespace: jppfs_cor
     */
    GainOnReversalOfLossOnValuationOfInvestmentSecuritiesNOI?: number;

    /**
     * 出資金運用益
     * Namespace: jppfs_cor
     */
    GainOnInvestmentsInCapitalNOI?: number;

    /**
     * 投資事業組合運用益
     * Namespace: jppfs_cor
     */
    GainOnInvestmentsInPartnershipNOI?: number;

    /**
     * 匿名組合投資利益
     * Namespace: jppfs_cor
     */
    GainOnInvestmentsInSilentPartnershipNOI?: number;

    /**
     * 金銭の信託運用益
     * Namespace: jppfs_cor
     */
    GainOnInvestmentsInMoneyHeldInTrustNOI?: number;

    /**
     * デリバティブ評価益
     * Namespace: jppfs_cor
     */
    GainOnValuationOfDerivativesNOI?: number;

    /**
     * 金利スワップ評価益
     * Namespace: jppfs_cor
     */
    GainOnValuationOfInterestRateSwapsNOI?: number;

    /**
     * 複合金融商品評価益
     * Namespace: jppfs_cor
     */
    GainOnValuationOfCompoundFinancialInstrumentsNOI?: number;

    /**
     * 経営指導料
     * Namespace: jppfs_cor
     */
    BusinessAdvisoryFeeNOI?: number;

    /**
     * 技術指導料
     * Namespace: jppfs_cor
     */
    TechnicalAdvisoryFeeNOI?: number;

    /**
     * 業務受託料
     * Namespace: jppfs_cor
     */
    FiduciaryObligationFeeNOI?: number;

    /**
     * 業務受託手数料
     * Namespace: jppfs_cor
     */
    OperationsConsignmentFeeNOI?: number;

    /**
     * 受取技術料
     * Namespace: jppfs_cor
     */
    TechnicalSupportFeeNOI?: number;

    /**
     * 受取ロイヤリティー
     * Namespace: jppfs_cor
     */
    RoyaltyIncomeNOI?: number;

    /**
     * 貸付金利息
     * Namespace: jppfs_cor
     */
    InterestOnLoansNOI?: number;

    /**
     * 受取手数料
     * Namespace: jppfs_cor
     */
    CommissionFeeNOI?: number;

    /**
     * 受取事務手数料
     * Namespace: jppfs_cor
     */
    OfficeWorkFeeNOI?: number;

    /**
     * 受取賃貸料
     * Namespace: jppfs_cor
     */
    RentIncomeNOI?: number;

    /**
     * 不動産賃貸料
     * Namespace: jppfs_cor
     */
    RealEstateRentNOI?: number;

    /**
     * 固定資産賃貸料
     * Namespace: jppfs_cor
     */
    RentIncomeOnNoncurrentAssetsNOI?: number;

    /**
     * 設備賃貸料
     * Namespace: jppfs_cor
     */
    RentIncomeOnFacilitiesNOI?: number;

    /**
     * 受取家賃
     * Namespace: jppfs_cor
     */
    HouseRentIncomeNOI?: number;

    /**
     * 受取地代家賃
     * Namespace: jppfs_cor
     */
    LandAndHouseRentReceivedNOI?: number;

    /**
     * 受取保険金
     * Namespace: jppfs_cor
     */
    InsuranceIncomeNOI?: number;

    /**
     * 受取保険金及び配当金
     * Namespace: jppfs_cor
     */
    InsuranceAndDividendsIncomeNOI?: number;

    /**
     * 受取保険料
     * Namespace: jppfs_cor
     */
    InsuranceFeeNOI?: number;

    /**
     * 受取保証料
     * Namespace: jppfs_cor
     */
    GuaranteeCommissionReceivedNOI?: number;

    /**
     * 受取補償金
     * Namespace: jppfs_cor
     */
    CompensationIncomeNOI?: number;

    /**
     * 受取利息及び配当金
     * Namespace: jppfs_cor
     */
    InterestAndDividendsIncomeNOI?: number;

    /**
     * 助成金収入
     * Namespace: jppfs_cor
     */
    SubsidyIncomeNOIBounty?: number;

    /**
     * 補助金収入
     * Namespace: jppfs_cor
     */
    SubsidyIncomeNOI?: number;

    /**
     * 協賛金収入
     * Namespace: jppfs_cor
     */
    CoSponsorFeeNOI?: number;

    /**
     * 違約金収入
     * Namespace: jppfs_cor
     */
    PenaltyIncomeNOI?: number;

    /**
     * 売電収入
     * Namespace: jppfs_cor
     */
    ElectricitySaleIncomeNOI?: number;

    /**
     * 保険解約返戻金
     * Namespace: jppfs_cor
     */
    InsurancePremiumsRefundedCancellationNOI?: number;

    /**
     * 保険返戻金
     * Namespace: jppfs_cor
     */
    InsuranceReturnNOI?: number;

    /**
     * 生命保険配当金
     * Namespace: jppfs_cor
     */
    DividendsIncomeOfLifeInsuranceNOI?: number;

    /**
     * 保険配当金
     * Namespace: jppfs_cor
     */
    DividendsIncomeOfInsuranceNOI?: number;

    /**
     * 保険事務手数料
     * Namespace: jppfs_cor
     */
    CommissionForInsuranceOfficeWorkNOI?: number;

    /**
     * 固定資産売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfNoncurrentAssetsNOI?: number;

    /**
     * 固定資産受贈益
     * Namespace: jppfs_cor
     */
    GainOnDonationOfNoncurrentAssetsNOI?: number;

    /**
     * 固定資産処分益
     * Namespace: jppfs_cor
     */
    GainOnDisposalOfNoncurrentAssetsNOI?: number;

    /**
     * 投資損失引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfAllowanceForInvestmentLossNOI?: number;

    /**
     * 役員退職慰労引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForDirectorsRetirementBenefitsNOI?: number;

    /**
     * 貸倒引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfAllowanceForDoubtfulAccountsNOI?: number;

    /**
     * 償却債権取立益
     * Namespace: jppfs_cor
     */
    GainOnBadDebtsRecoveredNOI?: number;

    /**
     * 物品売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfGoodsNOI?: number;

    /**
     * 作業くず売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfScraps1NOI?: number;

    /**
     * スクラップ売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfScraps2NOI?: number;

    /**
     * 債務勘定整理益
     * Namespace: jppfs_cor
     */
    GainOnAdjustmentOfAccountPayableNOI?: number;

    /**
     * 法人税等還付加算金
     * Namespace: jppfs_cor
     */
    InterestOnRefundOfIncomeTaxesAndOtherNOI?: number;

    /**
     * 還付加算金
     * Namespace: jppfs_cor
     */
    InterestOnRefundNOI?: number;

    /**
     * 雇用調整助成金
     * Namespace: jppfs_cor
     */
    SubsidiesForEmploymentAdjustmentNOI?: number;

    /**
     * 雑収入
     * Namespace: jppfs_cor
     */
    MiscellaneousIncomeNOI?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherNOI?: number;

    /**
     * 営業外収益
     * Namespace: jppfs_cor
     */
    NonOperatingIncome?: number;

    /**
     * 営業外費用
     * Namespace: jppfs_cor
     */
    NonOperatingExpensesAbstract?: string;

    /**
     * 支払利息
     * Namespace: jppfs_cor
     */
    InterestExpensesNOE?: number;

    /**
     * 社債利息
     * Namespace: jppfs_cor
     */
    InterestOnBondsNOE?: number;

    /**
     * 売上割引
     * Namespace: jppfs_cor
     */
    SalesDiscountsNOE?: number;

    /**
     * 有価証券売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfSecuritiesNOE?: number;

    /**
     * 有価証券評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfSecuritiesNOE?: number;

    /**
     * 有価証券償還損
     * Namespace: jppfs_cor
     */
    LossOnRedemptionOfSecuritiesNOE?: number;

    /**
     * 有価証券運用損
     * Namespace: jppfs_cor
     */
    LossOnInvestmentOfSecuritiesNOE?: number;

    /**
     * 投資有価証券売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfInvestmentSecuritiesNOE?: number;

    /**
     * 投資有価証券評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInvestmentSecuritiesNOE?: number;

    /**
     * 持分法による投資損失
     * Namespace: jppfs_cor
     */
    EquityInLossesOfAffiliatesNOE?: number;

    /**
     * 出資金運用損
     * Namespace: jppfs_cor
     */
    LossOnInvestmentsInCapitalNOE?: number;

    /**
     * 投資事業組合運用損
     * Namespace: jppfs_cor
     */
    LossOnInvestmentsInPartnershipNOE?: number;

    /**
     * 匿名組合投資損失
     * Namespace: jppfs_cor
     */
    LossOnInvestmentsInSilentPartnershipNOE?: number;

    /**
     * 出資金評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInvestmentsInCapitalNOE?: number;

    /**
     * 金銭の信託運用損
     * Namespace: jppfs_cor
     */
    LossOnInvestmentsInMoneyHeldInTrustNOE?: number;

    /**
     * デリバティブ評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfDerivativesNOE?: number;

    /**
     * ゴルフ会員権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfGolfClubMembershipNOE?: number;

    /**
     * 会員権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfMembershipNOE?: number;

    /**
     * 会員権売却損
     * Namespace: jppfs_cor
     */
    LossOnSaleOfMembershipNOE?: number;

    /**
     * 保険解約損
     * Namespace: jppfs_cor
     */
    LossOnInsuranceCancellationNOE?: number;

    /**
     * 社債発行費償却
     * Namespace: jppfs_cor
     */
    AmortizationOfBondIssuanceCostNOE?: number;

    /**
     * 株式交付費
     * Namespace: jppfs_cor
     */
    StockIssuanceCostNOE?: number;

    /**
     * 株式交付費償却
     * Namespace: jppfs_cor
     */
    AmortizationOfStockIssuanceCostNOE?: number;

    /**
     * 新株発行費
     * Namespace: jppfs_cor
     */
    StockIssuanceCostPriorNOE?: number;

    /**
     * 社債償還損
     * Namespace: jppfs_cor
     */
    LossOnBondRetirementNOE?: number;

    /**
     * 社債発行費
     * Namespace: jppfs_cor
     */
    BondIssuanceCostNOE?: number;

    /**
     * 新株予約権発行費
     * Namespace: jppfs_cor
     */
    ShareAcquisitionRightsIssuanceCostsNOE?: number;

    /**
     * 自己株式取得費用
     * Namespace: jppfs_cor
     */
    CommissionForPurchaseOfTreasuryStockNOE?: number;

    /**
     * 株式公開費用
     * Namespace: jppfs_cor
     */
    GoingPublicExpensesNOE?: number;

    /**
     * 資金調達費用
     * Namespace: jppfs_cor
     */
    FinancingExpensesNOE?: number;

    /**
     * 短期社債利息
     * Namespace: jppfs_cor
     */
    InterestOnShortTermBondsNOE?: number;

    /**
     * コマーシャル・ペーパー利息
     * Namespace: jppfs_cor
     */
    InterestOnCommercialPapersNOE?: number;

    /**
     * 為替差損
     * Namespace: jppfs_cor
     */
    ForeignExchangeLossesNOE?: number;

    /**
     * 金利スワップ評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInterestSwapNOE?: number;

    /**
     * 複合金融商品評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfCompoundFinancialInstrumentsNOE?: number;

    /**
     * 手形売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfNotesPayableNOE?: number;

    /**
     * 電子記録債権売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfElectronicallyRecordedMonetaryClaimsNOE?: number;

    /**
     * 貸与資産減価償却費
     * Namespace: jppfs_cor
     */
    DepreciationOfAssetsForRentNOE?: number;

    /**
     * 休止固定資産減価償却費
     * Namespace: jppfs_cor
     */
    DepreciationOfInactiveNoncurrentAssetsNOE?: number;

    /**
     * 減価償却費
     * Namespace: jppfs_cor
     */
    DepreciationNOE?: number;

    /**
     * 賃貸収入原価
     * Namespace: jppfs_cor
     */
    CostOfLeaseRevenueNOE?: number;

    /**
     * 賃貸費用
     * Namespace: jppfs_cor
     */
    RentExpensesNOE?: number;

    /**
     * 不動産賃貸費用
     * Namespace: jppfs_cor
     */
    RentExpensesOnRealEstatesNOE?: number;

    /**
     * 不動産賃貸原価
     * Namespace: jppfs_cor
     */
    RentCostOfRealEstateNOE?: number;

    /**
     * 固定資産賃貸費用
     * Namespace: jppfs_cor
     */
    RentExpensesOnNoncurrentAssetsNOE?: number;

    /**
     * 設備賃貸費用
     * Namespace: jppfs_cor
     */
    RentExpensesOnFacilitiesNOE?: number;

    /**
     * 売電費用
     * Namespace: jppfs_cor
     */
    ElectricitySaleExpensesNOE?: number;

    /**
     * リース解約損
     * Namespace: jppfs_cor
     */
    LossOnCancelOfLeaseContractsNOE?: number;

    /**
     * 固定資産売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfNoncurrentAssetsNOE?: number;

    /**
     * 固定資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfNoncurrentAssetsNOE?: number;

    /**
     * 固定資産除売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesAndRetirementOfNoncurrentAssetsNOE?: number;

    /**
     * 固定資産廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfNoncurrentAssetsNOE?: number;

    /**
     * 固定資産処分損
     * Namespace: jppfs_cor
     */
    LossOnDisposalOfNoncurrentAssetsNOE?: number;

    /**
     * 固定資産圧縮損
     * Namespace: jppfs_cor
     */
    LossOnReductionOfNoncurrentAssetsNOE?: number;

    /**
     * 棚卸資産評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInventoriesNOE?: number;

    /**
     * 棚卸資産廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfInventoriesNOE?: number;

    /**
     * 棚卸資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfInventoriesNOE?: number;

    /**
     * 棚卸資産処分損
     * Namespace: jppfs_cor
     */
    LossOnDisposalOfInventoriesNOE?: number;

    /**
     * 商品廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfGoodsNOE?: number;

    /**
     * 原材料評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfRawMaterialsNOE?: number;

    /**
     * 貸倒引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionOfAllowanceForDoubtfulAccountsNOE?: number;

    /**
     * 貸倒損失
     * Namespace: jppfs_cor
     */
    BadDebtsExpensesNOE?: number;

    /**
     * 退職給付費用
     * Namespace: jppfs_cor
     */
    RetirementBenefitExpensesNOE?: number;

    /**
     * 過年度退職給付費用
     * Namespace: jppfs_cor
     */
    RetirementBenefitExpensesForPriorPeriodsNOE?: number;

    /**
     * 退職給付会計基準変更時差異の処理額
     * Namespace: jppfs_cor
     */
    AmortizationOfNetRetirementBenefitObligationAtTransitionNOE?: number;

    /**
     * 割増退職金
     * Namespace: jppfs_cor
     */
    ExtraRetirementPaymentsNOE?: number;

    /**
     * 創立費償却
     * Namespace: jppfs_cor
     */
    AmortizationOfDeferredOrganizationExpensesNOE?: number;

    /**
     * 開業費償却
     * Namespace: jppfs_cor
     */
    AmortizationOfBusinessCommencementExpensesNOE?: number;

    /**
     * 長期前払費用償却
     * Namespace: jppfs_cor
     */
    AmortizationOfLongTermPrepaidExpensesNOE?: number;

    /**
     * 支払手数料
     * Namespace: jppfs_cor
     */
    CommissionFeeNOE?: number;

    /**
     * 支払保証料
     * Namespace: jppfs_cor
     */
    GuaranteeCommissionNOE?: number;

    /**
     * 支払補償費
     * Namespace: jppfs_cor
     */
    CompensationExpensesNOE?: number;

    /**
     * 租税公課
     * Namespace: jppfs_cor
     */
    TaxesAndDuesNOE?: number;

    /**
     * 寄付金
     * Namespace: jppfs_cor
     */
    ContributionNOE?: number;

    /**
     * 売上債権売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfAccountsReceivableNOE?: number;

    /**
     * 債権売却損
     * Namespace: jppfs_cor
     */
    LossOnTransferOfReceivablesNOE?: number;

    /**
     * コミットメントフィー
     * Namespace: jppfs_cor
     */
    CommitmentFeeNOE?: number;

    /**
     * シンジケートローン手数料
     * Namespace: jppfs_cor
     */
    CommissionForSyndicateLoanNOE?: number;

    /**
     * 事務所移転費用
     * Namespace: jppfs_cor
     */
    OfficeTransferExpensesNOE?: number;

    /**
     * 和解金
     * Namespace: jppfs_cor
     */
    SettlementPackageNOE?: number;

    /**
     * 訴訟和解金
     * Namespace: jppfs_cor
     */
    LitigationSettlementNOE?: number;

    /**
     * 訴訟関連費用
     * Namespace: jppfs_cor
     */
    LitigationExpensesNOE?: number;

    /**
     * 上場関連費用
     * Namespace: jppfs_cor
     */
    ListingExpensesNOE?: number;

    /**
     * 雑支出
     * Namespace: jppfs_cor
     */
    MiscellaneousExpensesNOE?: number;

    /**
     * 雑損失
     * Namespace: jppfs_cor
     */
    MiscellaneousLossNOE?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherNOE?: number;

    /**
     * 営業外費用
     * Namespace: jppfs_cor
     */
    NonOperatingExpenses?: number;

    /**
     * 経常利益又は経常損失（△）
     * Namespace: jppfs_cor
     */
    OrdinaryIncome?: number;

    /**
     * 特別利益
     * Namespace: jppfs_cor
     */
    ExtraordinaryIncomeAbstract?: string;

    /**
     * 企業結合に係る特定勘定取崩益
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionIncurredFromBusinessCombinationEI?: number;

    /**
     * 企業結合における交換利益
     * Namespace: jppfs_cor
     */
    GainOnExchangeFromBusinessCombinationEI?: number;

    /**
     * 事業分離における移転利益
     * Namespace: jppfs_cor
     */
    GainOnTransferFromBusinessDivestituresEI?: number;

    /**
     * 段階取得に係る差益
     * Namespace: jppfs_cor
     */
    GainOnStepAcquisitionsEI?: number;

    /**
     * 持分変動利益
     * Namespace: jppfs_cor
     */
    GainOnChangeInEquityEI?: number;

    /**
     * 抱合せ株式消滅差益
     * Namespace: jppfs_cor
     */
    GainOnExtinguishmentOfTieInSharesEI?: number;

    /**
     * 固定資産売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfNoncurrentAssetsEI?: number;

    /**
     * 固定資産処分益
     * Namespace: jppfs_cor
     */
    GainOnDisposalOfNoncurrentAssetsEI?: number;

    /**
     * 固定資産受贈益
     * Namespace: jppfs_cor
     */
    GainOnDonationOfNoncurrentAssetsEI?: number;

    /**
     * 有形固定資産売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfPropertyPlantAndEquipmentEI?: number;

    /**
     * 土地売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfLandEI?: number;

    /**
     * 投資有価証券売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfInvestmentSecuritiesEI?: number;

    /**
     * 投資有価証券償還益
     * Namespace: jppfs_cor
     */
    GainOnRedemptionOfInvestmentSecuritiesEI?: number;

    /**
     * 有価証券売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfSecuritiesEI?: number;

    /**
     * 投資有価証券評価損戻入益
     * Namespace: jppfs_cor
     */
    GainOnReversalOfLossOnValuationOfInvestmentSecuritiesEI?: number;

    /**
     * 匿名組合投資利益
     * Namespace: jppfs_cor
     */
    GainOnInvestmentsInSilentPartnershipEI?: number;

    /**
     * ゴルフ会員権売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfGolfMembershipsEI?: number;

    /**
     * 会員権売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfMembershipsEI?: number;

    /**
     * 負ののれん発生益
     * Namespace: jppfs_cor
     */
    GainOnNegativeGoodwillEI?: number;

    /**
     * 関係会社清算益
     * Namespace: jppfs_cor
     */
    GainOnLiquidationOfSubsidiariesAndAffiliatesEI?: number;

    /**
     * 子会社清算益
     * Namespace: jppfs_cor
     */
    GainOnLiquidationOfSubsidiariesEI?: number;

    /**
     * 関係会社株式売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfSubsidiariesAndAffiliatesStocksEI?: number;

    /**
     * 子会社株式売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfSubsidiariesStocksEI?: number;

    /**
     * 事業譲渡益
     * Namespace: jppfs_cor
     */
    GainOnTransferOfBusinessEI?: number;

    /**
     * 貸倒引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfAllowanceForDoubtfulAccountsEI?: number;

    /**
     * 賞与引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForBonusesEI?: number;

    /**
     * 退職給付引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForRetirementBenefitsEI?: number;

    /**
     * 役員退職慰労引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForDirectorsRetirementBenefitsEI?: number;

    /**
     * 投資損失引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfAllowanceForInvestmentLossEI?: number;

    /**
     * 製品保証引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForProductWarrantiesEI?: number;

    /**
     * 特別修繕引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForSpecialRepairsEI?: number;

    /**
     * 完成工事補償引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForWarrantiesForCompletedConstructionEI?: number;

    /**
     * 債務保証損失引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForLossOnGuaranteesEI?: number;

    /**
     * 関係会社整理損失引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForLossOnLiquidationOfSubsidiariesAndAffiliatesEI?: number;

    /**
     * 事業整理損失引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForLossOnBusinessLiquidationEI?: number;

    /**
     * 関係会社事業損失引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForLossOnBusinessOfSubsidiariesAndAffiliatesEI?: number;

    /**
     * 事業構造改善引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForBusinessStructureImprovementEI?: number;

    /**
     * 店舗閉鎖損失引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForLossOnStoreClosingEI?: number;

    /**
     * 訴訟損失引当金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfProvisionForLossOnLitigationEI?: number;

    /**
     * 災害損失引当金戻入額
     * Namespace: jppfs_cor
     */
    GainOnReversalOfProvisionForLossOnDisasterEI?: number;

    /**
     * 退職給付信託設定益
     * Namespace: jppfs_cor
     */
    GainOnContributionOfSecuritiesToRetirementBenefitTrustEI?: number;

    /**
     * 厚生年金基金代行返上益
     * Namespace: jppfs_cor
     */
    GainOnTransferOfBenefitObligationRelatingToEmployeesPensionFundEI?: number;

    /**
     * 退職給付制度改定益
     * Namespace: jppfs_cor
     */
    GainOnRevisionOfRetirementBenefitPlanEI?: number;

    /**
     * 退職給付制度終了益
     * Namespace: jppfs_cor
     */
    GainOnAbolishmentOfRetirementBenefitPlanEI?: number;

    /**
     * 為替差益
     * Namespace: jppfs_cor
     */
    ForeignExchangeGainsEI?: number;

    /**
     * 特別法上の準備金戻入額
     * Namespace: jppfs_cor
     */
    ReversalOfReservesUnderTheSpecialLawsEI?: number;

    /**
     * 工事負担金等受入額
     * Namespace: jppfs_cor
     */
    ContributionForConstructionEI?: number;

    /**
     * 国庫補助金
     * Namespace: jppfs_cor
     */
    StateSubsidyEI?: number;

    /**
     * 助成金収入
     * Namespace: jppfs_cor
     */
    SubsidyIncome2EI?: number;

    /**
     * 補助金収入
     * Namespace: jppfs_cor
     */
    SubsidyEI?: number;

    /**
     * 新株予約権戻入益
     * Namespace: jppfs_cor
     */
    GainOnReversalOfSubscriptionRightsToSharesEI?: number;

    /**
     * 資産除去債務戻入益
     * Namespace: jppfs_cor
     */
    GainOnReversalOfAssetRetirementObligationsEI?: number;

    /**
     * 保険解約返戻金
     * Namespace: jppfs_cor
     */
    SurrenderValueOfInsuranceEI?: number;

    /**
     * 受取保険金
     * Namespace: jppfs_cor
     */
    InsuranceIncomeEI?: number;

    /**
     * 保険差益
     * Namespace: jppfs_cor
     */
    GainOnInsuranceAdjustmentEI?: number;

    /**
     * 受取補償金
     * Namespace: jppfs_cor
     */
    CompensationIncomeEI?: number;

    /**
     * 収用補償金
     * Namespace: jppfs_cor
     */
    CompensationIncomeForExpropriationEI?: number;

    /**
     * 移転補償金
     * Namespace: jppfs_cor
     */
    CompensationForTransferEI?: number;

    /**
     * 受取和解金
     * Namespace: jppfs_cor
     */
    SettlementReceivedEI?: number;

    /**
     * 違約金収入
     * Namespace: jppfs_cor
     */
    PenaltyIncomeEI?: number;

    /**
     * 償却債権取立益
     * Namespace: jppfs_cor
     */
    GainOnBadDebtsRecoveredEI?: number;

    /**
     * 債務免除益
     * Namespace: jppfs_cor
     */
    GainOnForgivenessOfDebtsEI?: number;

    /**
     * 雇用調整助成金
     * Namespace: jppfs_cor
     */
    SubsidiesForEmploymentAdjustmentEI?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherEI?: number;

    /**
     * 特別利益
     * Namespace: jppfs_cor
     */
    ExtraordinaryIncome?: number;

    /**
     * 特別損失
     * Namespace: jppfs_cor
     */
    ExtraordinaryLossAbstract?: string;

    /**
     * 企業結合における交換損失
     * Namespace: jppfs_cor
     */
    LossOnExchangeFromBusinessCombinationEL?: number;

    /**
     * 事業分離における移転損失
     * Namespace: jppfs_cor
     */
    LossOnTransferFromBusinessDivestituresEL?: number;

    /**
     * 段階取得に係る差損
     * Namespace: jppfs_cor
     */
    LossOnStepAcquisitionsEL?: number;

    /**
     * 持分変動損失
     * Namespace: jppfs_cor
     */
    LossOnChangeInEquityEL?: number;

    /**
     * 抱合せ株式消滅差損
     * Namespace: jppfs_cor
     */
    LossOnExtinguishmentOfTieInSharesEL?: number;

    /**
     * 合併関連費用
     * Namespace: jppfs_cor
     */
    MergerExpensesEL?: number;

    /**
     * 固定資産売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfNoncurrentAssetsEL?: number;

    /**
     * 減損損失
     * Namespace: jppfs_cor
     */
    ImpairmentLossEL?: number;

    /**
     * 災害による損失
     * Namespace: jppfs_cor
     */
    LossOnDisasterEL?: number;

    /**
     * 固定資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfNoncurrentAssetsEL?: number;

    /**
     * 固定資産除売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesAndRetirementOfNoncurrentAssetsEL?: number;

    /**
     * 固定資産廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfNoncurrentAssetsEL?: number;

    /**
     * 固定資産処分損
     * Namespace: jppfs_cor
     */
    LossOnDisposalOfNoncurrentAssetsEL?: number;

    /**
     * 固定資産圧縮損
     * Namespace: jppfs_cor
     */
    LossOnReductionOfNoncurrentAssetsEL?: number;

    /**
     * 固定資産評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfNoncurrentAssetsEL?: number;

    /**
     * 有形固定資産売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfPropertyPlantAndEquipmentEL?: number;

    /**
     * 有形固定資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfPropertyPlantAndEquipmentEL?: number;

    /**
     * 有形固定資産処分損
     * Namespace: jppfs_cor
     */
    LossOnDisposalOfPropertyPlantAndEquipmentEL?: number;

    /**
     * 土地売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfLandEL?: number;

    /**
     * 投資有価証券売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfInvestmentSecuritiesEL?: number;

    /**
     * 投資有価証券評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInvestmentSecuritiesEL?: number;

    /**
     * 投資有価証券償還損
     * Namespace: jppfs_cor
     */
    LossOnRedemptionOfInvestmentSecuritiesEL?: number;

    /**
     * 有価証券売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfSecuritiesEL?: number;

    /**
     * 有価証券評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfSecuritiesEL?: number;

    /**
     * 匿名組合投資損失
     * Namespace: jppfs_cor
     */
    LossOnInvestmentsInSilentPartnershipEL?: number;

    /**
     * 出資金評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInvestmentsInCapitalEL?: number;

    /**
     * 関係会社株式評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfStocksOfSubsidiariesAndAffiliatesEL?: number;

    /**
     * 関係会社株式売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfStocksOfSubsidiariesAndAffiliatesEL?: number;

    /**
     * 投資損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionOfAllowanceForInvestmentLossEL?: number;

    /**
     * 関係会社出資金評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInvestmentsInCapitalOfSubsidiariesAndAffiliatesEL?: number;

    /**
     * 子会社株式売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfSubsidiariesStocksEL?: number;

    /**
     * 子会社株式評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfSubsidiariesStocksEL?: number;

    /**
     * 関係会社整理損
     * Namespace: jppfs_cor
     */
    LossOnLiquidationOfSubsidiariesAndAffiliatesGeneralEL?: number;

    /**
     * 関係会社整理損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnLiquidationOfSubsidiariesAndAffiliatesEL?: number;

    /**
     * 事業整理損
     * Namespace: jppfs_cor
     */
    LossOnLiquidationOfBusinessEL?: number;

    /**
     * 事業整理損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnBusinessLiquidationEL?: number;

    /**
     * 関係会社事業損失
     * Namespace: jppfs_cor
     */
    LossOnBusinessOfSubsidiariesAndAffiliatesEL?: number;

    /**
     * 関係会社事業損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnBusinessOfSubsidiariesAndAffiliatesEL?: number;

    /**
     * 事業構造改善費用
     * Namespace: jppfs_cor
     */
    BusinessStructureImprovementExpensesEL?: number;

    /**
     * 事業構造改善引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForBusinessStructureImprovementEL?: number;

    /**
     * 関係会社清算損
     * Namespace: jppfs_cor
     */
    LossOnLiquidationOfSubsidiariesAndAffiliatesEL?: number;

    /**
     * 子会社整理損
     * Namespace: jppfs_cor
     */
    LossOnLiquidationOfSubsidiariesGeneralEL?: number;

    /**
     * 子会社清算損
     * Namespace: jppfs_cor
     */
    LossOnLiquidationOfSubsidiariesEL?: number;

    /**
     * 事業再編損
     * Namespace: jppfs_cor
     */
    RestructuringLossEL?: number;

    /**
     * 事業撤退損
     * Namespace: jppfs_cor
     */
    LossOnBusinessWithdrawalEL?: number;

    /**
     * 事業譲渡損
     * Namespace: jppfs_cor
     */
    LossOnTransferOfBusinessEL?: number;

    /**
     * 関係会社支援損
     * Namespace: jppfs_cor
     */
    LossOnSupportToSubsidiariesAndSubsidiariesAndAffiliatesEL?: number;

    /**
     * 関係会社貸倒引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionOfAllowanceForDoubtfulAccountsForSubsidiariesAndAffiliatesEL?: number;

    /**
     * その他の投資評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfOtherInvestmentsEL?: number;

    /**
     * ゴルフ会員権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfGolfClubMembershipEL?: number;

    /**
     * ゴルフ会員権貸倒引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionOfAllowanceForDoubtfulAccountsOfGolfClubMembershipEL?: number;

    /**
     * ゴルフ会員権売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfGolfClubMembershipsEL?: number;

    /**
     * 会員権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfMembershipEL?: number;

    /**
     * 会員権売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfMembershipEL?: number;

    /**
     * 電話加入権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfTelephoneSubscriptionRightEL?: number;

    /**
     * 施設利用権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfRightOfUsingFacilitiesEL?: number;

    /**
     * 特別退職金
     * Namespace: jppfs_cor
     */
    SpecialRetirementExpensesEL?: number;

    /**
     * 割増退職金
     * Namespace: jppfs_cor
     */
    ExtraRetirementPaymentsEL?: number;

    /**
     * 早期割増退職金
     * Namespace: jppfs_cor
     */
    EarlyExtraRetirementPaymentsEL?: number;

    /**
     * 退職特別加算金
     * Namespace: jppfs_cor
     */
    SpecialExtraRetirementPaymentsEL?: number;

    /**
     * 店舗閉鎖損失
     * Namespace: jppfs_cor
     */
    LossOnClosingOfStoresEL?: number;

    /**
     * 店舗閉鎖損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnStoreClosingEL?: number;

    /**
     * 事務所移転費用
     * Namespace: jppfs_cor
     */
    OfficeTransferExpensesEL?: number;

    /**
     * 本社移転費用
     * Namespace: jppfs_cor
     */
    HeadOfficeTransferCostEL?: number;

    /**
     * 債務保証損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnGuaranteesEL?: number;

    /**
     * 貸倒引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionOfAllowanceForDoubtfulAccountsEL?: number;

    /**
     * 貸倒損失
     * Namespace: jppfs_cor
     */
    BadDebtsWrittenOffEL?: number;

    /**
     * 棚卸資産評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInventoriesEL?: number;

    /**
     * 棚卸資産処分損
     * Namespace: jppfs_cor
     */
    LossOnDisposalOfInventoriesEL?: number;

    /**
     * 棚卸資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfInventoriesEL?: number;

    /**
     * 棚卸資産廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfInventoriesEL?: number;

    /**
     * 商品評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfGoodsEL?: number;

    /**
     * 商品廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfGoodsEL?: number;

    /**
     * 建物除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfBuildingEL?: number;

    /**
     * 為替差損
     * Namespace: jppfs_cor
     */
    ForeignExchangeLossesEL?: number;

    /**
     * 工事負担金等圧縮額
     * Namespace: jppfs_cor
     */
    ReductionEntryOfLandContributionForConstructionEL?: number;

    /**
     * ソフトウエア除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfSoftwareEL?: number;

    /**
     * 賃貸借契約解約損
     * Namespace: jppfs_cor
     */
    LossOnCancellationOfLeaseholdContractsEL?: number;

    /**
     * リース解約損
     * Namespace: jppfs_cor
     */
    LossOnCancellationOfLeaseContractsEL?: number;

    /**
     * 保険解約損
     * Namespace: jppfs_cor
     */
    LossOnInsuranceCancellationEL?: number;

    /**
     * 退職給付費用
     * Namespace: jppfs_cor
     */
    RetirementBenefitExpensesEL?: number;

    /**
     * 過年度退職給付費用
     * Namespace: jppfs_cor
     */
    RetirementBenefitExpensesForPriorPeriodsEL?: number;

    /**
     * 役員退職慰労金
     * Namespace: jppfs_cor
     */
    DirectorsRetirementBenefitsEL?: number;

    /**
     * 役員退職慰労引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForDirectorsRetirementBenefitsEL?: number;

    /**
     * 退職給付制度改定損
     * Namespace: jppfs_cor
     */
    LossOnRevisionOfRetirementBenefitPlanEL?: number;

    /**
     * 退職給付制度終了損
     * Namespace: jppfs_cor
     */
    LossOnAbolishmentOfRetirementBenefitPlanEL?: number;

    /**
     * 損害賠償金
     * Namespace: jppfs_cor
     */
    CompensationForDamageEL?: number;

    /**
     * 和解金
     * Namespace: jppfs_cor
     */
    SettlementPackageEL?: number;

    /**
     * 訴訟和解金
     * Namespace: jppfs_cor
     */
    LitigationSettlementEL?: number;

    /**
     * 訴訟関連損失
     * Namespace: jppfs_cor
     */
    LossOnLitigationEL?: number;

    /**
     * 訴訟損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnLitigationEL?: number;

    /**
     * 環境対策引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForEnvironmentalMeasuresEL?: number;

    /**
     * 環境対策費
     * Namespace: jppfs_cor
     */
    EnvironmentalExpensesEL?: number;

    /**
     * 偶発損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForContingentLossEL?: number;

    /**
     * 災害損失引当金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionForLossOnDisasterEL?: number;

    /**
     * 臨時損失
     * Namespace: jppfs_cor
     */
    NonrecurringLossEL?: number;

    /**
     * 特別法上の準備金繰入額
     * Namespace: jppfs_cor
     */
    ProvisionOfReservesUnderTheSpecialLawsEL?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherEL?: number;

    /**
     * 特別損失
     * Namespace: jppfs_cor
     */
    ExtraordinaryLoss?: number;

    /**
     * 匿名組合損益分配前税引前当期純利益又は純損失（△）
     * Namespace: jppfs_cor
     */
    IncomeBeforeDividendsDistributionFromSilentPartnershipIncomeTaxes?: number;

    /**
     * 匿名組合損益分配額
     * Namespace: jppfs_cor
     */
    DividendsDistributionFromSilentPartnership?: number;

    /**
     * 税引前当期純利益又は税引前当期純損失（△）
     * Namespace: jppfs_cor
     */
    IncomeBeforeIncomeTaxes?: number;

    /**
     * 法人税等
     * Namespace: jppfs_cor
     */
    IncomeTaxes?: number;

    /**
     * 法人税、住民税及び事業税
     * Namespace: jppfs_cor
     */
    IncomeTaxesCurrent?: number;

    /**
     * 法人税等の更正、決定等による納付税額又は還付税額
     * Namespace: jppfs_cor
     */
    IncomeTaxesCorrection?: number;

    /**
     * 法人税等調整額
     * Namespace: jppfs_cor
     */
    IncomeTaxesDeferred?: number;

    /**
     * 法人税等還付税額
     * Namespace: jppfs_cor
     */
    RefundOfIncomeTaxesIncomeTaxes?: number;

    /**
     * 過年度法人税等
     * Namespace: jppfs_cor
     */
    IncomeTaxesForPriorPeriodsIncomeTaxes?: number;

    /**
     * 過年度法人税等戻入額
     * Namespace: jppfs_cor
     */
    RefundOfIncomeTaxesForPriorPeriodsIncomeTaxes?: number;

    /**
     * 当期純利益又は当期純損失（△）
     * Namespace: jppfs_cor
     */
    ProfitLoss?: number;

    /**
     * （内訳）
     * Namespace: jppfs_cor
     */
    ProfitAttributableToAbstract?: string;

    /**
     * 非支配株主に帰属する当期純利益又は非支配株主に帰属する当期純損失（△）
     * Namespace: jppfs_cor
     */
    ProfitLossAttributableToNonControllingInterests?: number;

    /**
     * 親会社株主に帰属する当期純利益又は親会社株主に帰属する当期純損失（△）
     * Namespace: jppfs_cor
     */
    ProfitLossAttributableToOwnersOfParent?: number;

    /**
     * その他の包括利益
     * Namespace: jppfs_cor
     */
    OtherComprehensiveIncomeAbstract?: string;

    /**
     * その他有価証券評価差額金（税引前）
     * Namespace: jppfs_cor
     */
    ValuationDifferenceOnAvailableForSaleSecuritiesBeforeTaxOCI?: number;

    /**
     * その他有価証券評価差額金
     * Namespace: jppfs_cor
     */
    ValuationDifferenceOnAvailableForSaleSecuritiesNetOfTaxOCI?: number;

    /**
     * 繰延ヘッジ損益（税引前）
     * Namespace: jppfs_cor
     */
    DeferredGainsOrLossesOnHedgesBeforeTaxOCI?: number;

    /**
     * 繰延ヘッジ損益
     * Namespace: jppfs_cor
     */
    DeferredGainsOrLossesOnHedgesNetOfTaxOCI?: number;

    /**
     * 土地再評価差額金
     * Namespace: jppfs_cor
     */
    RevaluationReserveForLandNetOfTaxOCI?: number;

    /**
     * 為替換算調整勘定（税引前）
     * Namespace: jppfs_cor
     */
    ForeignCurrencyTranslationAdjustmentBeforeTaxOCI?: number;

    /**
     * 為替換算調整勘定
     * Namespace: jppfs_cor
     */
    ForeignCurrencyTranslationAdjustmentNetOfTaxOCI?: number;

    /**
     * 退職給付に係る調整額（税引前）
     * Namespace: jppfs_cor
     */
    RemeasurementsOfDefinedBenefitPlansBeforeTaxOCI?: number;

    /**
     * 退職給付に係る調整額
     * Namespace: jppfs_cor
     */
    RemeasurementsOfDefinedBenefitPlansNetOfTaxOCI?: number;

    /**
     * 持分法適用会社に対する持分相当額
     * Namespace: jppfs_cor
     */
    ShareOfOtherComprehensiveIncomeOfAssociatesAccountedForUsingEquityMethodOCI?: number;

    /**
     * その他の包括利益に係る税効果額
     * Namespace: jppfs_cor
     */
    IncomeTaxRelatingToOtherComprehensiveIncomeOCI?: number;

    /**
     * その他の包括利益に関する法人税等及び税効果額
     * Namespace: jppfs_cor
     */
    IncomeTaxesAndTaxEffectsRelatingToOtherComprehensiveIncomeOCI?: number;

    /**
     * その他の包括利益
     * Namespace: jppfs_cor
     */
    OtherComprehensiveIncome?: number;

    /**
     * 包括利益
     * Namespace: jppfs_cor
     */
    ComprehensiveIncome?: number;

    /**
     * （内訳）
     * Namespace: jppfs_cor
     */
    ComprehensiveIncomeAttributableToAbstract?: string;

    /**
     * 親会社株主に係る包括利益
     * Namespace: jppfs_cor
     */
    ComprehensiveIncomeAttributableToOwnersOfTheParent?: number;

    /**
     * 非支配株主に係る包括利益
     * Namespace: jppfs_cor
     */
    ComprehensiveIncomeAttributableToNonControllingInterests?: number;

    /**
     * 包括利益計算書
     * Namespace: jppfs_cor
     */
    StatementOfComprehensiveIncomeAbstract?: string;

    /**
     * 包括利益計算書
     * Namespace: jppfs_cor
     */
    StatementOfComprehensiveIncomeTable?: string;

    /**
     * 包括利益計算書
     * Namespace: jppfs_cor
     */
    StatementOfComprehensiveIncomeLineItems?: string;

    /**
     * 株主資本等変動計算書
     * Namespace: jppfs_cor
     */
    StatementOfChangesInEquityAbstract?: string;

    /**
     * 株主資本等変動計算書
     * Namespace: jppfs_cor
     */
    StatementOfChangesInEquityTable?: string;

    /**
     * 純資産の内訳項目
     * Namespace: jppfs_cor
     */
    ComponentsOfEquityAxis?: string;

    /**
     * 株主資本等変動計算書
     * Namespace: jppfs_cor
     */
    StatementOfChangesInEquityLineItems?: string;

    /**
     * 会計方針の変更による累積的影響額
     * Namespace: jppfs_cor
     */
    CumulativeEffectsOfChangesInAccountingPolicies?: number;

    /**
     * 会計方針の変更を反映した当期首残高
     * Namespace: jppfs_cor
     */
    RestatedBalance?: number;

    /**
     * 当期変動額
     * Namespace: jppfs_cor
     */
    ChangesOfItemsDuringThePeriodAbstract?: string;

    /**
     * 新株の発行
     * Namespace: jppfs_cor
     */
    IssuanceOfNewShares?: number;

    /**
     * 新株の発行（新株予約権の行使）
     * Namespace: jppfs_cor
     */
    IssuanceOfNewSharesexerciseOfSubscriptionRightsToShares?: number;

    /**
     * 剰余金（その他資本剰余金）の配当
     * Namespace: jppfs_cor
     */
    DividendsFromSurplusotherCapitalSurplus?: number;

    /**
     * 剰余金の配当
     * Namespace: jppfs_cor
     */
    DividendsFromSurplus?: number;

    /**
     * 自己株式の取得
     * Namespace: jppfs_cor
     */
    PurchaseOfTreasuryStock?: number;

    /**
     * 自己株式の処分
     * Namespace: jppfs_cor
     */
    DisposalOfTreasuryStock?: number;

    /**
     * 自己株式処分差損の振替
     * Namespace: jppfs_cor
     */
    TransferOfLossOnDisposalOfTreasuryStock?: number;

    /**
     * 自己株式の消却
     * Namespace: jppfs_cor
     */
    RetirementOfTreasuryStock?: number;

    /**
     * 持分法適用会社に対する持分変動に伴う自己株式の増減
     * Namespace: jppfs_cor
     */
    ChangeInEquityInAffiliatesAccountedForByEquityMethodtreasuryStock?: number;

    /**
     * 連結範囲の変動
     * Namespace: jppfs_cor
     */
    ChangeOfScopeOfConsolidation?: number;

    /**
     * 持分法の適用範囲の変動
     * Namespace: jppfs_cor
     */
    ChangeOfScopeOfEquityMethod?: number;

    /**
     * 合併による増加
     * Namespace: jppfs_cor
     */
    IncreaseByMerger?: number;

    /**
     * 会社分割による増加
     * Namespace: jppfs_cor
     */
    IncreaseByCorporateDivision?: number;

    /**
     * 株式交換による増加
     * Namespace: jppfs_cor
     */
    IncreaseByShareExchanges?: number;

    /**
     * 株式移転による増加
     * Namespace: jppfs_cor
     */
    IncreaseByShareTransfers?: number;

    /**
     * 分割型の会社分割による減少
     * Namespace: jppfs_cor
     */
    DecreaseByCorporateDivisionsplitoffType?: number;

    /**
     * 資本金から準備金への振替
     * Namespace: jppfs_cor
     */
    TransferToLegalCapitalSurplusFromCapitalStock?: number;

    /**
     * 資本金から剰余金への振替
     * Namespace: jppfs_cor
     */
    TransferToOtherCapitalSurplusFromCapitalStock?: number;

    /**
     * 準備金から資本金への振替
     * Namespace: jppfs_cor
     */
    TransferToCapitalStockFromLegalCapitalSurplus?: number;

    /**
     * 準備金から剰余金への振替
     * Namespace: jppfs_cor
     */
    TransferToOtherCapitalSurplusFromLegalCapitalSurplus?: number;

    /**
     * 利益剰余金から資本剰余金への振替
     * Namespace: jppfs_cor
     */
    TransferToCapitalSurplusFromRetainedEarnings?: number;

    /**
     * その他有価証券の売却による増減
     * Namespace: jppfs_cor
     */
    SalesOfAvailableforsaleSecurities?: number;

    /**
     * その他有価証券の減損処理による増減
     * Namespace: jppfs_cor
     */
    ImpairmentOfAvailableforsaleSecurities?: number;

    /**
     * 純資産の部に直接計上されたその他有価証券評価差額金の増減
     * Namespace: jppfs_cor
     */
    InsertedDirectlyIntoNetAssetsvaluationDifferenceOnAvailableforsaleSecurities?: number;

    /**
     * 連結子会社の増資による持分の増減
     * Namespace: jppfs_cor
     */
    CapitalIncreaseOfConsolidatedSubsidiaries?: number;

    /**
     * ヘッジ対象の損益認識による増減
     * Namespace: jppfs_cor
     */
    RealizedGainOrLossOnHedgedObject?: number;

    /**
     * ヘッジ会計の終了による増減
     * Namespace: jppfs_cor
     */
    ClosingOfHedging?: number;

    /**
     * 純資産の部に直接計上された繰延ヘッジ損益の増減
     * Namespace: jppfs_cor
     */
    InsertedDirectlyIntoNetAssetsdeferredGainsOrLossesOnHedges?: number;

    /**
     * 在外連結子会社等の株式の売却による増減
     * Namespace: jppfs_cor
     */
    SalesOfStockOfForeignConsolidatedSubsidiaries?: number;

    /**
     * 連結範囲の変動に伴う為替換算調整勘定の増減
     * Namespace: jppfs_cor
     */
    ChangeOfScopeOfConsolidationforeignCurrencyTranslationAdjustment?: number;

    /**
     * 純資産の部に直接計上された為替換算調整勘定の増減
     * Namespace: jppfs_cor
     */
    InsertedDirectlyIntoNetAssetsforeignCurrencyTranslationAdjustment?: number;

    /**
     * 新株予約権の発行
     * Namespace: jppfs_cor
     */
    IssuanceOfSubscriptionRightsToShares?: number;

    /**
     * 新株予約権の取得
     * Namespace: jppfs_cor
     */
    PurchaseOfSubscriptionRightsToShares?: number;

    /**
     * 新株予約権の行使
     * Namespace: jppfs_cor
     */
    ExerciseOfSubscriptionRightsToShares?: number;

    /**
     * 新株予約権の失効
     * Namespace: jppfs_cor
     */
    LapseOfSubscriptionRightsToShares?: number;

    /**
     * 自己新株予約権の消却
     * Namespace: jppfs_cor
     */
    RetirementOfTreasurySubscriptionRightsToShares?: number;

    /**
     * 自己新株予約権の処分
     * Namespace: jppfs_cor
     */
    DisposalOfTreasurySubscriptionRightsToShares?: number;

    /**
     * 連結子会社の増加による非支配株主持分の増減
     * Namespace: jppfs_cor
     */
    IncreaseOfConsolidatedSubsidiariesNonControllingInterests?: number;

    /**
     * 連結子会社の減少による非支配株主持分の増減
     * Namespace: jppfs_cor
     */
    DecreaseOfConsolidatedSubsidiariesNonControllingInterests?: number;

    /**
     * 連結子会社株式の取得による持分の増減
     * Namespace: jppfs_cor
     */
    PurchaseOfSharesOfConsolidatedSubsidiaries?: number;

    /**
     * 連結子会社株式の売却による持分の増減
     * Namespace: jppfs_cor
     */
    SalesOfSharesOfConsolidatedSubsidiaries?: number;

    /**
     * 非支配株主との取引に係る親会社の持分変動
     * Namespace: jppfs_cor
     */
    ChangeInTreasurySharesOfParentArisingFromTransactionsWithNonControllingShareholders?: number;

    /**
     * 株主資本以外の項目の当期変動額（純額）
     * Namespace: jppfs_cor
     */
    NetChangesOfItemsOtherThanShareholdersEquity?: number;

    /**
     * 利益準備金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfLegalRetainedEarnings?: number;

    /**
     * 利益準備金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfLegalRetainedEarnings?: number;

    /**
     * 欠損填補
     * Namespace: jppfs_cor
     */
    DeficitDisposition?: number;

    /**
     * 減資
     * Namespace: jppfs_cor
     */
    CapitalReduction?: number;

    /**
     * 資本準備金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfLegalCapitalSurplus?: number;

    /**
     * 土地再評価差額金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfRevaluationReserveForLand?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    Other?: number;

    /**
     * 配当平均積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForDividendEqualization?: number;

    /**
     * 配当平均積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForDividendEqualization?: number;

    /**
     * 固定資産圧縮積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForAdvancedDepreciationOfNoncurrentAssets?: number;

    /**
     * 固定資産圧縮積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForAdvancedDepreciationOfNoncurrentAssets?: number;

    /**
     * 固定資産圧縮特別勘定積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForSpecialAccountForAdvancedDepreciationOfNoncurrentAssets?: number;

    /**
     * 固定資産圧縮特別勘定積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForSpecialAccountForAdvancedDepreciationOfNoncurrentAssets?: number;

    /**
     * 特別償却準備金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForSpecialDepreciation?: number;

    /**
     * 特別償却準備金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForSpecialDepreciation?: number;

    /**
     * 海外投資等損失準備金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForOverseasInvestmentLoss?: number;

    /**
     * 海外投資等損失準備金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForOverseasInvestmentLoss?: number;

    /**
     * 研究開発積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForResearchAndDevelopment?: number;

    /**
     * 研究開発積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForResearchAndDevelopment?: number;

    /**
     * 配当積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForDividends1?: number;

    /**
     * 配当積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForDividends1?: number;

    /**
     * 配当準備金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForDividends2?: number;

    /**
     * 配当準備金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForDividends2?: number;

    /**
     * 配当準備積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForDividends3?: number;

    /**
     * 配当準備積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForDividends3?: number;

    /**
     * 配当引当積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForDividends4?: number;

    /**
     * 配当引当積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForDividends4?: number;

    /**
     * 退職給与積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForRetirementAllowance1?: number;

    /**
     * 退職給与積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForRetirementAllowance1?: number;

    /**
     * 退職積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForRetirementAllowance2?: number;

    /**
     * 退職積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForRetirementAllowance2?: number;

    /**
     * 退職手当積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForRetirementAllowance3?: number;

    /**
     * 退職手当積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForRetirementAllowance3?: number;

    /**
     * 退職慰労積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForRetirementAllowance4?: number;

    /**
     * 退職慰労積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForRetirementAllowance4?: number;

    /**
     * 役員退職積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForDirectorsRetirementAllowance?: number;

    /**
     * 役員退職積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForDirectorsRetirementAllowance?: number;

    /**
     * 圧縮記帳積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForReductionEntry1?: number;

    /**
     * 圧縮記帳積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForReductionEntry1?: number;

    /**
     * 圧縮積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForReductionEntry2?: number;

    /**
     * 圧縮積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForReductionEntry2?: number;

    /**
     * 土地圧縮積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForReductionEntryOfLand?: number;

    /**
     * 土地圧縮積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForReductionEntryOfLand?: number;

    /**
     * 建物圧縮積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForReductionEntryOfBuildings?: number;

    /**
     * 建物圧縮積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForReductionEntryOfBuildings?: number;

    /**
     * 不動産圧縮積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForReductionEntryOfRealEstate?: number;

    /**
     * 不動産圧縮積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForReductionEntryOfRealEstate?: number;

    /**
     * 資産圧縮積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForReductionEntryOfAssets?: number;

    /**
     * 資産圧縮積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForReductionEntryOfAssets?: number;

    /**
     * 償却資産圧縮積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForReductionEntryOfDepreciableAssets?: number;

    /**
     * 償却資産圧縮積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForReductionEntryOfDepreciableAssets?: number;

    /**
     * 買換資産圧縮積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForReductionEntryOfReplacedProperty?: number;

    /**
     * 買換資産圧縮積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForReductionEntryOfReplacedProperty?: number;

    /**
     * 買換資産積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForPropertyReplacement?: number;

    /**
     * 買換資産積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForPropertyReplacement?: number;

    /**
     * 特別償却積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfReserveForSpecialDepreciationGeneral?: number;

    /**
     * 特別償却積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfReserveForSpecialDepreciationGeneral?: number;

    /**
     * 特別積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfSpecialReserve?: number;

    /**
     * 特別積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfSpecialReserve?: number;

    /**
     * 任意積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfVoluntaryRetainedEarnings?: number;

    /**
     * 任意積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfVoluntaryRetainedEarnings?: number;

    /**
     * 別途積立金の積立
     * Namespace: jppfs_cor
     */
    ProvisionOfGeneralReserve?: number;

    /**
     * 別途積立金の取崩
     * Namespace: jppfs_cor
     */
    ReversalOfGeneralReserve?: number;

    /**
     * 税率変更による積立金の調整額
     * Namespace: jppfs_cor
     */
    AdjustmentToReserveDueToChangeInTaxRate?: number;

    /**
     * 当期変動額合計
     * Namespace: jppfs_cor
     */
    TotalChangesOfItemsDuringThePeriod?: number;

    /**
     * キャッシュ・フロー計算書
     * Namespace: jppfs_cor
     */
    StatementOfCashFlowsAbstract?: string;

    /**
     * キャッシュ・フロー計算書
     * Namespace: jppfs_cor
     */
    StatementOfCashFlowsTable?: string;

    /**
     * キャッシュ・フロー計算書
     * Namespace: jppfs_cor
     */
    StatementOfCashFlowsLineItems?: string;

    /**
     * 営業活動によるキャッシュ・フロー
     * Namespace: jppfs_cor
     */
    NetCashProvidedByUsedInOperatingActivitiesAbstract?: string;

    /**
     * 小計
     * Namespace: jppfs_cor
     */
    SubtotalOpeCF?: number;

    /**
     * 営業収入
     * Namespace: jppfs_cor
     */
    OperatingIncomeOpeCF?: number;

    /**
     * 原材料又は商品の仕入れによる支出
     * Namespace: jppfs_cor
     */
    PaymentsForRawMaterialsAndGoodsOpeCF?: number;

    /**
     * 人件費の支出
     * Namespace: jppfs_cor
     */
    PaymentsForPayrollOpeCF?: number;

    /**
     * その他の営業支出
     * Namespace: jppfs_cor
     */
    PaymentsForOtherOperatingActivityOpeCF?: number;

    /**
     * 減価償却費
     * Namespace: jppfs_cor
     */
    DepreciationAndAmortizationOpeCF?: number;

    /**
     * 減損損失
     * Namespace: jppfs_cor
     */
    ImpairmentLossOpeCF?: number;

    /**
     * のれん償却額
     * Namespace: jppfs_cor
     */
    AmortizationOfGoodwillOpeCF?: number;

    /**
     * 貸倒引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAllowanceForDoubtfulAccountsOpeCF?: number;

    /**
     * 受取利息及び受取配当金
     * Namespace: jppfs_cor
     */
    InterestAndDividendsIncomeOpeCF?: number;

    /**
     * 支払利息
     * Namespace: jppfs_cor
     */
    InterestExpensesOpeCF?: number;

    /**
     * 為替差損益（△は益）
     * Namespace: jppfs_cor
     */
    ForeignExchangeLossesGainsOpeCF?: number;

    /**
     * 持分法による投資損益（△は益）
     * Namespace: jppfs_cor
     */
    EquityInEarningsLossesOfAffiliatesOpeCF?: number;

    /**
     * 有形固定資産売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfPropertyPlantAndEquipmentOpeCF?: number;

    /**
     * 損害賠償損失
     * Namespace: jppfs_cor
     */
    LossOnCompensationForDamageOpeCF?: number;

    /**
     * 売上債権の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInNotesAndAccountsReceivableTradeOpeCF?: number;

    /**
     * 棚卸資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInInventoriesOpeCF?: number;

    /**
     * 仕入債務の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInNotesAndAccountsPayableTradeOpeCF?: number;

    /**
     * 抱合せ株式消滅差損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnExtinguishmentOfTieInSharesOpeCF?: number;

    /**
     * 投資有価証券売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfInvestmentSecuritiesOpeCF?: number;

    /**
     * 減価償却費及びその他の償却費
     * Namespace: jppfs_cor
     */
    DepreciationAndOtherAmortizationOpeCF?: number;

    /**
     * ソフトウエア償却費
     * Namespace: jppfs_cor
     */
    DepreciationOfSoftwareOpeCF?: number;

    /**
     * 開業費償却額
     * Namespace: jppfs_cor
     */
    AmortizationOfBusinessCommencementExpensesOpeCF?: number;

    /**
     * 差入保証金償却額
     * Namespace: jppfs_cor
     */
    AmortizationOfGuaranteeDepositsOpeCF?: number;

    /**
     * 長期前払費用償却額
     * Namespace: jppfs_cor
     */
    AmortizationOfLongTermPrepaidExpensesOpeCF?: number;

    /**
     * 繰延資産償却額
     * Namespace: jppfs_cor
     */
    AmortizationOfDeferredAssetsOpeCF?: number;

    /**
     * 無形固定資産償却費
     * Namespace: jppfs_cor
     */
    DepreciationOfIntangibleAssetsOpeCF?: number;

    /**
     * 負ののれん償却額
     * Namespace: jppfs_cor
     */
    AmortizationOfNegativeGoodwillOpeCF?: number;

    /**
     * 負ののれん発生益
     * Namespace: jppfs_cor
     */
    GainOnNegativeGoodwillOpeCF?: number;

    /**
     * その他の償却額
     * Namespace: jppfs_cor
     */
    DepreciationAndAmortizationOnOtherOpeCF?: number;

    /**
     * 退職給付費用
     * Namespace: jppfs_cor
     */
    RetirementBenefitExpensesOpeCF?: number;

    /**
     * 株式報酬費用
     * Namespace: jppfs_cor
     */
    ShareBasedCompensationExpensesOpeCF?: number;

    /**
     * 上場関連費用
     * Namespace: jppfs_cor
     */
    ListingExpensesOpeCF?: number;

    /**
     * 賞与引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForBonusesOpeCF?: number;

    /**
     * 製品保証引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForProductWarrantiesOpeCF?: number;

    /**
     * 役員退職慰労引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForDirectorsRetirementBenefitsOpeCF?: number;

    /**
     * 役員賞与引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForDirectorsBonusesOpeCF?: number;

    /**
     * 退職給付に係る負債の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInNetDefinedBenefitLiabilityOpeCF?: number;

    /**
     * 退職給付に係る資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInNetDefinedBenefitAssetOpeCF?: number;

    /**
     * 退職給付引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForRetirementBenefitsOpeCF?: number;

    /**
     * 退職給付及び役員退職慰労引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForRetirementBenefitsAndDirectorsRetirementBenefitsOpeCF?: number;

    /**
     * 修繕引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForRepairsOpeCF?: number;

    /**
     * 特別修繕引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForSpecialRepairsOpeCF?: number;

    /**
     * ポイント引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForPointCardCertificatesOpeCF?: number;

    /**
     * 株主優待引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForShareholderBenefitProgramOpeCF?: number;

    /**
     * 完成工事補償引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForWarrantiesForCompletedConstructionOpeCF?: number;

    /**
     * 工事損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnConstructionContractsOpeCF?: number;

    /**
     * 債務保証損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnGuaranteesOpeCF?: number;

    /**
     * 受注損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnOrderReceivedOpeCF?: number;

    /**
     * 投資損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAllowanceForInvestmentLossOpeCF?: number;

    /**
     * 返品調整引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForSalesReturnsOpeCF?: number;

    /**
     * 店舗閉鎖損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnStoreClosingOpeCF?: number;

    /**
     * 販売促進引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForSalesPromotionExpensesOpeCF?: number;

    /**
     * 関係会社事業損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnBusinessOfSubsidiariesAndAffiliatesOpeCF?: number;

    /**
     * 関係会社整理損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnLiquidationOfSubsidiariesAndAffiliatesOpeCF?: number;

    /**
     * 事業整理損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnBusinessLiquidationOpeCF?: number;

    /**
     * 事業構造改善引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForBusinessStructureImprovementOpeCF?: number;

    /**
     * 環境対策引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForEnvironmentalMeasuresOpeCF?: number;

    /**
     * 訴訟損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnLitigationOpeCF?: number;

    /**
     * 利息返還損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnInterestRepaymentOpeCF?: number;

    /**
     * 偶発損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForContingentLossOpeCF?: number;

    /**
     * 災害損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnDisasterOpeCF?: number;

    /**
     * 株式給付引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForShareBasedRemunerationOpeCF?: number;

    /**
     * 役員株式給付引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForShareBasedRemunerationForDirectorsAndOtherOfficersOpeCF?: number;

    /**
     * 株式報酬引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForShareBasedPaymentsOpeCF?: number;

    /**
     * その他の引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInOtherProvisionOpeCF?: number;

    /**
     * 引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionOpeCF?: number;

    /**
     * 特別法上の準備金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInReservesUnderTheSpecialLaws1OpeCF?: number;

    /**
     * 特別法上の引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInReservesUnderTheSpecialLaws2OpeCF?: number;

    /**
     * 有価証券売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfSecuritiesOpeCF?: number;

    /**
     * 有価証券評価損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnValuationOfSecuritiesOpeCF?: number;

    /**
     * 有価証券運用損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSecuritiesOperationOpeCF?: number;

    /**
     * 有価証券償還損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnRedemptionOfSecuritiesOpeCF?: number;

    /**
     * 投資有価証券売却及び評価損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesAndValuationOfInvestmentSecuritiesOpeCF?: number;

    /**
     * 投資有価証券評価損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnValuationOfInvestmentSecuritiesOpeCF?: number;

    /**
     * 投資有価証券償還損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnRedemptionOfInvestmentSecuritiesOpeCF?: number;

    /**
     * 有価証券及び投資有価証券売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfShortTermAndLongTermInvestmentSecuritiesOpeCF?: number;

    /**
     * 有価証券及び投資有価証券評価損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnValuationOfShortTermAndLongTermInvestmentSecuritiesOpeCF?: number;

    /**
     * 関係会社株式売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfStocksOfSubsidiariesAndAffiliatesOpeCF?: number;

    /**
     * 関係会社株式評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfStocksOfSubsidiariesAndAffiliatesOpeCF?: number;

    /**
     * 子会社株式売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfSubsidiariesStocksOpeCF?: number;

    /**
     * デリバティブ評価損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnValuationOfDerivativesOpeCF?: number;

    /**
     * 金利スワップ評価損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnValuationOfInterestSwapOpeCF?: number;

    /**
     * 複合金融商品評価損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnValuationOfCompoundFinancialInstrumentsOpeCF?: number;

    /**
     * 固定資産売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfNoncurrentAssetsOpeCF?: number;

    /**
     * 固定資産売却益
     * Namespace: jppfs_cor
     */
    GainOnSalesOfNonCurrentAssetsOpeCF?: number;

    /**
     * 固定資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfNoncurrentAssetsOpeCF?: number;

    /**
     * 固定資産除売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesAndRetirementOfNoncurrentAssetsOpeCF?: number;

    /**
     * 固定資産廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfNoncurrentAssetsOpeCF?: number;

    /**
     * 固定資産処分損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnDisposalOfNoncurrentAssetsOpeCF?: number;

    /**
     * 固定資産評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfNoncurrentAssetsOpeCF?: number;

    /**
     * 固定資産圧縮損
     * Namespace: jppfs_cor
     */
    LossOnReductionOfNoncurrentAssetsOpeCF?: number;

    /**
     * 固定資産受贈益
     * Namespace: jppfs_cor
     */
    GainOnDonationOfNoncurrentAssetsOpeCF?: number;

    /**
     * 有形固定資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfPropertyPlantAndEquipmentOpeCF?: number;

    /**
     * 有形固定資産除売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesAndRetirementOfPropertyPlantAndEquipmentOpeCF?: number;

    /**
     * 有形固定資産廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfPropertyPlantAndEquipmentOpeCF?: number;

    /**
     * 有形固定資産処分損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnDisposalOfPropertyPlantAndEquipmentOpeCF?: number;

    /**
     * 無形固定資産売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfIntangibleAssetsOpeCF?: number;

    /**
     * 無形固定資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfIntangibleAssetsOpeCF?: number;

    /**
     * 無形固定資産除売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesAndRetirementOfIntangibleAssetsOpeCF?: number;

    /**
     * 有形及び無形固定資産売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfPropertyPlantAndEquipmentAndIntangibleAssetsOpeCF?: number;

    /**
     * 有形及び無形固定資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfPropertyPlantAndEquipmentAndIntangibleAssetsOpeCF?: number;

    /**
     * 有形及び無形固定資産除売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesAndRetirementOfPropertyPlantAndEquipmentAndIntangibleAssetsOpeCF?: number;

    /**
     * 有形及び無形固定資産処分損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnDisposalOfPropertyPlantAndEquipmentAndIntangibleAssetsOpeCF?: number;

    /**
     * 土地売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfLandOpeCF?: number;

    /**
     * 電話加入権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfTelephoneSubscriptionRightOpeCF?: number;

    /**
     * 施設利用権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfRightOfUsingFacilitiesOpeCF?: number;

    /**
     * 出資金運用損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnOperationOfInvestmentsInCapitalOpeCF?: number;

    /**
     * 出資金評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInvestmentsInCapitalOpeCF?: number;

    /**
     * 投資事業組合運用損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnInvestmentsInPartnershipOpeCF?: number;

    /**
     * 匿名組合投資損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnInvestmentsInSilentPartnershipOpeCF?: number;

    /**
     * ゴルフ会員権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfGolfClubMembershipsOpeCF?: number;

    /**
     * ゴルフ会員権売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfGolfClubMembershipsOpeCF?: number;

    /**
     * 会員権売却損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSalesOfMembershipOpeCF?: number;

    /**
     * 会員権評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfMembershipOpeCF?: number;

    /**
     * 投資その他の資産評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfOtherInvestmentsOpeCF?: number;

    /**
     * 受取利息
     * Namespace: jppfs_cor
     */
    InterestIncomeOpeCF?: number;

    /**
     * 受取配当金
     * Namespace: jppfs_cor
     */
    DividendsIncomeOpeCF?: number;

    /**
     * 有価証券利息
     * Namespace: jppfs_cor
     */
    InterestIncomeOnSecuritiesOpeCF?: number;

    /**
     * 保険解約返戻金
     * Namespace: jppfs_cor
     */
    SurrenderValueOfInsuranceOpeCF?: number;

    /**
     * 保険配当金
     * Namespace: jppfs_cor
     */
    DividendsIncomeOfInsuranceOpeCF?: number;

    /**
     * 保険返戻金
     * Namespace: jppfs_cor
     */
    GainOnMaturityOfInsuranceContractOpeCF?: number;

    /**
     * 受取賃貸料
     * Namespace: jppfs_cor
     */
    RentIncomeOpeCF?: number;

    /**
     * 受取保険金
     * Namespace: jppfs_cor
     */
    InsuranceIncomeOpeCF?: number;

    /**
     * 保険解約損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnCancellationOfInsuranceContractOpeCF?: number;

    /**
     * 仕入割引
     * Namespace: jppfs_cor
     */
    PurchaseDiscountsOpeCF?: number;

    /**
     * 支払手数料
     * Namespace: jppfs_cor
     */
    CommissionFeeOpeCF?: number;

    /**
     * 支払利息及び社債利息
     * Namespace: jppfs_cor
     */
    InterestExpensesPaidOnLoansAndBondsOpeCF?: number;

    /**
     * 支払利息及び手形売却損
     * Namespace: jppfs_cor
     */
    InterestExpensesAndLossOnSalesOfNotesReceivableTradeOpeCF?: number;

    /**
     * 手形売却損
     * Namespace: jppfs_cor
     */
    LossOnSalesOfNotesReceivableTradeOpeCF?: number;

    /**
     * 社債利息
     * Namespace: jppfs_cor
     */
    InterestOnBondsOpeCF?: number;

    /**
     * 社債償還損
     * Namespace: jppfs_cor
     */
    LossOnRedemptionOfBondsOpeCF?: number;

    /**
     * 社債発行費
     * Namespace: jppfs_cor
     */
    BondIssuanceCostOpeCF?: number;

    /**
     * 社債発行費償却
     * Namespace: jppfs_cor
     */
    AmortizationOfBondIssuanceCostOpeCF?: number;

    /**
     * 新株発行費
     * Namespace: jppfs_cor
     */
    StockIssuanceCostPriorOpeCF?: number;

    /**
     * 株式交付費
     * Namespace: jppfs_cor
     */
    StockIssuanceCostOpeCF?: number;

    /**
     * 株式交付費償却
     * Namespace: jppfs_cor
     */
    AmortizationOfStockIssuanceCostOpeCF?: number;

    /**
     * 株式公開費用
     * Namespace: jppfs_cor
     */
    GoingPublicExpensesOpeCF?: number;

    /**
     * 賃貸借契約解約損
     * Namespace: jppfs_cor
     */
    LossOnCancellationOfRentalContractOpeCF?: number;

    /**
     * リース解約損
     * Namespace: jppfs_cor
     */
    LossOnCancellationOfLeasesOpeCF?: number;

    /**
     * 貸倒損失
     * Namespace: jppfs_cor
     */
    BadDebtsExpensesOpeCF?: number;

    /**
     * 棚卸資産評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfInventoriesOpeCF?: number;

    /**
     * 棚卸資産廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfInventoriesOpeCF?: number;

    /**
     * 棚卸資産除却損
     * Namespace: jppfs_cor
     */
    LossOnRetirementOfInventoriesOpeCF?: number;

    /**
     * 棚卸資産処分損
     * Namespace: jppfs_cor
     */
    LossOnDisposalOfInventoriesOpeCF?: number;

    /**
     * 商品評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfGoodsOpeCF?: number;

    /**
     * 商品廃棄損
     * Namespace: jppfs_cor
     */
    LossOnAbandonmentOfGoodsOpeCF?: number;

    /**
     * 販売用不動産評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfRealEstateForSaleOpeCF?: number;

    /**
     * 販売用土地評価損
     * Namespace: jppfs_cor
     */
    LossOnValuationOfLandForSaleOpeCF?: number;

    /**
     * 債務免除益
     * Namespace: jppfs_cor
     */
    GainOnForgivenessOfDebtOpeCF?: number;

    /**
     * 災害損失
     * Namespace: jppfs_cor
     */
    LossOnDisasterOpeCF?: number;

    /**
     * 災害による損失
     * Namespace: jppfs_cor
     */
    LossOnDisaster2OpeCF?: number;

    /**
     * 受取補償金
     * Namespace: jppfs_cor
     */
    CompensationIncomeOpeCF?: number;

    /**
     * 移転補償金
     * Namespace: jppfs_cor
     */
    CompensationForRemovalOpeCF?: number;

    /**
     * 収用補償金
     * Namespace: jppfs_cor
     */
    CompensationIncomeForExpropriationOpeCF?: number;

    /**
     * 工事負担金等受入額
     * Namespace: jppfs_cor
     */
    ProceedsFromContributionForConstructionOpeCF?: number;

    /**
     * 補助金収入
     * Namespace: jppfs_cor
     */
    SubsidyIncomeOpeCF?: number;

    /**
     * 助成金収入
     * Namespace: jppfs_cor
     */
    SubsidyIncome2OpeCF?: number;

    /**
     * 雇用調整助成金
     * Namespace: jppfs_cor
     */
    SubsidiesForEmploymentAdjustmentOpeCF?: number;

    /**
     * 保険差益
     * Namespace: jppfs_cor
     */
    GainOnInsuranceClaimOpeCF?: number;

    /**
     * 新株予約権戻入益
     * Namespace: jppfs_cor
     */
    GainOnReversalOfSubscriptionRightsToSharesOpeCF?: number;

    /**
     * 段階取得に係る差損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnStepAcquisitionsOpeCF?: number;

    /**
     * 持分変動損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnChangeInEquityOpeCF?: number;

    /**
     * 事業再編損
     * Namespace: jppfs_cor
     */
    LossOnBusinessRestructuringOpeCF?: number;

    /**
     * 事業整理損
     * Namespace: jppfs_cor
     */
    LossOnLiquidationOfBusinessOpeCF?: number;

    /**
     * 事業撤退損
     * Namespace: jppfs_cor
     */
    LossOnWithdrawalFromBusinessOpeCF?: number;

    /**
     * 関係会社事業損失
     * Namespace: jppfs_cor
     */
    LossOnBusinessOfSubsidiariesAndAffiliatesOpeCF?: number;

    /**
     * 事業構造改善費用
     * Namespace: jppfs_cor
     */
    BusinessStructureImprovementExpensesOpeCF?: number;

    /**
     * 関係会社整理損
     * Namespace: jppfs_cor
     */
    LossOnLiquidationOfSubsidiariesAndAffiliatesOpeCF?: number;

    /**
     * 子会社整理損
     * Namespace: jppfs_cor
     */
    LossOnLiquidationOfSubsidiariesOpeCF?: number;

    /**
     * 関係会社清算損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnLiquidationOfSubsidiariesAndAffiliatesOpeCF?: number;

    /**
     * 子会社清算損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnLiquidationOfSubsidiariesOpeCF?: number;

    /**
     * 事業譲渡損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnTransferOfBusinessOpeCF?: number;

    /**
     * 店舗閉鎖損失
     * Namespace: jppfs_cor
     */
    LossOnStoreClosingsOpeCF?: number;

    /**
     * 移転費用
     * Namespace: jppfs_cor
     */
    RelocationExpensesOpeCF?: number;

    /**
     * 受取和解金
     * Namespace: jppfs_cor
     */
    SettlementReceivedOpeCF?: number;

    /**
     * 和解金
     * Namespace: jppfs_cor
     */
    SettlementPackageOpeCF?: number;

    /**
     * 訴訟和解金
     * Namespace: jppfs_cor
     */
    LitigationSettlementOpeCF?: number;

    /**
     * 訴訟関連損失
     * Namespace: jppfs_cor
     */
    LossOnLitigationOpeCF?: number;

    /**
     * 特別退職金
     * Namespace: jppfs_cor
     */
    ExtraRetirementPaymentOpeCF?: number;

    /**
     * 役員退職慰労金
     * Namespace: jppfs_cor
     */
    DirectorsRetirementBenefitsOpeCF?: number;

    /**
     * 退職給付会計基準変更時差異の処理額
     * Namespace: jppfs_cor
     */
    AmortizationOfNetRetirementBenefitObligationAtTransitionOpeCF?: number;

    /**
     * 退職給付信託設定損益（△は益）
     * Namespace: jppfs_cor
     */
    LossGainOnSecuritiesContributionToEmployeesRetirementBenefitsTrustOpeCF?: number;

    /**
     * 雑損失
     * Namespace: jppfs_cor
     */
    MiscellaneousExpensesOpeCF?: number;

    /**
     * 雑収入
     * Namespace: jppfs_cor
     */
    ProceedsFromMiscellaneousIncomeOpeCF?: number;

    /**
     * その他の営業外損益（△は益）
     * Namespace: jppfs_cor
     */
    OtherNonOperatingExpensesIncomeOpeCF?: number;

    /**
     * その他の特別損益（△は益）
     * Namespace: jppfs_cor
     */
    OtherExtraordinaryLossIncomeOpeCF?: number;

    /**
     * その他の損益（△は益）
     * Namespace: jppfs_cor
     */
    OtherLossGainOpeCF?: number;

    /**
     * 営業債権の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInOperatingReceivablesOpeCF?: number;

    /**
     * 売上債権及び契約資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInAccountsReceivableTradeAndContractAssetsOpeCF?: number;

    /**
     * 営業債務の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInOperatingDebtOpeCF?: number;

    /**
     * 契約負債の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInContractLiabilitiesOpeCF?: number;

    /**
     * 割引手形の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInNotesDiscountedOpeCF?: number;

    /**
     * リース債権及びリース投資資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    NetDecreaseIncreaseInLeaseReceivablesAndInvestmentAssetsOpeCF?: number;

    /**
     * 販売用不動産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInRealEstateForSaleOpeCF?: number;

    /**
     * 割賦売掛金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInAccountsReceivableInstallmentOpeCF?: number;

    /**
     * 立替金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInAdvancesPaidOpeCF?: number;

    /**
     * 預け金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInDepositsPaidOpeCF?: number;

    /**
     * 前受収益の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInUnearnedRevenueOpeCF?: number;

    /**
     * 前受金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAdvancesReceivedOpeCF?: number;

    /**
     * 前渡金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInAdvancePaymentsOpeCF?: number;

    /**
     * 前払年金費用の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInPrepaidPensionCostsOpeCF?: number;

    /**
     * 前払費用の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInPrepaidExpensesOpeCF?: number;

    /**
     * 保険積立金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInInsuranceFundsOpeCF?: number;

    /**
     * 貯蔵品の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInSuppliesOpeCF?: number;

    /**
     * 未収消費税等の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInConsumptionTaxesRefundReceivableOpeCF?: number;

    /**
     * 未収入金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInAccountsReceivableOtherOpeCF?: number;

    /**
     * 未成業務受入金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAdvancesReceivedOnUncompletedServicesOpeCF?: number;

    /**
     * 未払金及び未払費用の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAccountsPayableOtherAndAccruedExpensesOpeCF?: number;

    /**
     * 未払金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAccountsPayableOtherOpeCF?: number;

    /**
     * 未払費用の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAccruedExpensesOpeCF?: number;

    /**
     * 未払債務の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAccruedLiabilitiesOpeCF?: number;

    /**
     * 未払消費税等の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAccruedConsumptionTaxesOpeCF?: number;

    /**
     * 未払賞与の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAccountsPayableBonusesOpeCF?: number;

    /**
     * 未払法人税等（外形標準課税）の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInIncomeTaxesPayableTheFactorBasedTaxOpeCF?: number;

    /**
     * 未払人件費の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInAccountsPayableLaborCostOpeCF?: number;

    /**
     * 未払又は未収消費税等の増減額
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInConsumptionTaxesReceivablePayableOpeCF?: number;

    /**
     * 預り金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInDepositsReceivedOpeCF?: number;

    /**
     * 長期前払費用の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInLongTermPrepaidExpensesOpeCF?: number;

    /**
     * 長期未払金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInLongTermAccountsPayableOtherOpeCF?: number;

    /**
     * 長期預り金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInLongTermDepositsReceivedOpeCF?: number;

    /**
     * 破産更生債権等の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInClaimsProvableInBankruptcyClaimsProvableInRehabilitationOpeCF?: number;

    /**
     * 敷金及び保証金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInLeaseAndGuaranteeDepositsOpeCF?: number;

    /**
     * 差入保証金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInGuaranteeDepositsOpeCF?: number;

    /**
     * 預り敷金及び保証金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInLeaseAndGuaranteeDepositsReceivedOpeCF?: number;

    /**
     * 預り保証金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInGuaranteeDepositsReceivedOpeCF?: number;

    /**
     * 営業貸付金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInOperatingLoansReceivableOpeCF?: number;

    /**
     * 営業投資有価証券の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInInvestmentSecuritiesForSaleOpeCF?: number;

    /**
     * 固定化営業債権の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInBadDebtsOpeCF?: number;

    /**
     * 割賦利益繰延の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInDeferredInstallmentIncomeOpeCF?: number;

    /**
     * 借入有価証券代り金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInCollateralMoneyForSecuritiesBorrowedOpeCF?: number;

    /**
     * リース債権の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInLeaseReceivablesOpeCF?: number;

    /**
     * リース債務の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInLeaseObligationsOpeCF?: number;

    /**
     * リース投資資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInLeaseInvestmentAssetsOpeCF?: number;

    /**
     * その他の流動資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInOtherCurrentAssetsOpeCF?: number;

    /**
     * その他の流動負債の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInOtherCurrentLiabilitiesOpeCF?: number;

    /**
     * その他の固定資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInOtherNoncurrentAssetsOpeCF?: number;

    /**
     * その他の固定負債の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInOtherNoncurrentLiabilitiesOpeCF?: number;

    /**
     * その他の資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInOtherAssetsOpeCF?: number;

    /**
     * その他の負債の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInOtherLiabilitiesOpeCF?: number;

    /**
     * その他の資産・負債の増減額
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInOtherAssetsLiabilitiesOpeCF?: number;

    /**
     * 預り敷金及び保証金の返還による支出
     * Namespace: jppfs_cor
     */
    RepaymentsOfLeaseAndGuaranteeDepositsReceivedOpeCF?: number;

    /**
     * 預り敷金及び保証金の受入による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromLeaseAndGuaranteeDepositsReceivedOpeCF?: number;

    /**
     * 賃貸資産の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfAssetsForRentOpeCF?: number;

    /**
     * 賃貸資産の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfAssetsForRentOpeCF?: number;

    /**
     * 受注工事損失引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForLossOnConstructionContractsOpeCFVES?: number;

    /**
     * 保証工事引当金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInProvisionForConstructionWarrantiesOpeCFVES?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherNetOpeCF?: number;

    /**
     * 利息及び配当金の受取額
     * Namespace: jppfs_cor
     */
    InterestAndDividendsIncomeReceivedOpeCFInvCF?: number;

    /**
     * 利息の支払額
     * Namespace: jppfs_cor
     */
    InterestExpensesPaidOpeCFFinCF?: number;

    /**
     * 利息の受取額
     * Namespace: jppfs_cor
     */
    InterestIncomeReceivedOpeCF?: number;

    /**
     * 法人税等の支払額
     * Namespace: jppfs_cor
     */
    IncomeTaxesPaidOpeCF?: number;

    /**
     * 法人税等の還付額
     * Namespace: jppfs_cor
     */
    IncomeTaxesRefundOpeCF?: number;

    /**
     * 法人税等の支払額又は還付額（△は支払）
     * Namespace: jppfs_cor
     */
    IncomeTaxesPaidRefundOpeCF?: number;

    /**
     * 特別退職金の支払額
     * Namespace: jppfs_cor
     */
    PaymentsForExtraRetirementPaymentsOpeCF?: number;

    /**
     * 補償金の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromCompensationOpeCF?: number;

    /**
     * 収用補償金の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromCompensationForExpropriationOpeCF?: number;

    /**
     * 移転補償金の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromCompensationForRemovalOpeCF?: number;

    /**
     * 助成金の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromSubsidyIncome2OpeCF?: number;

    /**
     * 雇用調整助成金の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromSubsidiesForEmploymentAdjustmentOpeCF?: number;

    /**
     * 移転費用の支払額
     * Namespace: jppfs_cor
     */
    PaymentsForRemovalExpensesOpeCF?: number;

    /**
     * 補助金の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromSubsidyOpeCF?: number;

    /**
     * 保険金の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromInsuranceIncomeOpeCF?: number;

    /**
     * 損害賠償金の支払額
     * Namespace: jppfs_cor
     */
    CompensationForDamagePaidOpeCF?: number;

    /**
     * 和解金の受取額
     * Namespace: jppfs_cor
     */
    SettlementPackageReceivedOpeCF?: number;

    /**
     * 和解金の支払額
     * Namespace: jppfs_cor
     */
    SettlementPackagePaidOpeCF?: number;

    /**
     * 訴訟和解金の支払額
     * Namespace: jppfs_cor
     */
    LitigationSettlementPaidOpeCF?: number;

    /**
     * 訴訟関連損失の支払額
     * Namespace: jppfs_cor
     */
    PaymentsForLossOnLitigationOpeCF?: number;

    /**
     * 災害損失の支払額
     * Namespace: jppfs_cor
     */
    PaymentsForLossOnDisasterOpeCF?: number;

    /**
     * 災害による損失の支払額
     * Namespace: jppfs_cor
     */
    PaymentsAssociatedWithDisasterLoss2OpeCF?: number;

    /**
     * 賃貸料の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromRentIncomeOpeCF?: number;

    /**
     * 役員退職慰労金の支払額
     * Namespace: jppfs_cor
     */
    PaymentsForDirectorsRetirementBenefitsOpeCF?: number;

    /**
     * 事業再編による支出
     * Namespace: jppfs_cor
     */
    PaymentsForBusinessRestructuringOpeCF?: number;

    /**
     * 手形売却に伴う支払額
     * Namespace: jppfs_cor
     */
    PaymentsForSalesOfNotesReceivableTradeOpeCF?: number;

    /**
     * 持分法適用会社からの配当金の受取額
     * Namespace: jppfs_cor
     */
    ProceedsFromDividendsIncomeFromEquityMethodAffiliateOpeCF?: number;

    /**
     * その他の支出
     * Namespace: jppfs_cor
     */
    OtherPaymentsOpeCF?: number;

    /**
     * その他の収入
     * Namespace: jppfs_cor
     */
    OtherProceedsOpeCF?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherNetOpeCFSubtotal?: number;

    /**
     * 営業活動によるキャッシュ・フロー
     * Namespace: jppfs_cor
     */
    NetCashProvidedByUsedInOperatingActivities?: number;

    /**
     * 投資活動によるキャッシュ・フロー
     * Namespace: jppfs_cor
     */
    NetCashProvidedByUsedInInvestmentActivitiesAbstract?: string;

    /**
     * 有価証券の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfShortTermInvestmentSecuritiesInvCF?: number;

    /**
     * 有価証券の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfShortTermInvestmentSecuritiesInvCF?: number;

    /**
     * 有価証券の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInShortTermInvestmentSecuritiesInvCF?: number;

    /**
     * 有価証券の純増減額（△は増加）
     * Namespace: jppfs_cor
     */
    NetDecreaseIncreaseInShortTermInvestmentSecuritiesInvCF?: number;

    /**
     * 有形固定資産の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfPropertyPlantAndEquipmentInvCF?: number;

    /**
     * 有形固定資産の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfPropertyPlantAndEquipmentInvCF?: number;

    /**
     * 投資有価証券の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfInvestmentSecuritiesInvCF?: number;

    /**
     * 投資有価証券の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfInvestmentSecuritiesInvCF?: number;

    /**
     * 貸付けによる支出
     * Namespace: jppfs_cor
     */
    PaymentsOfLoansReceivableInvCF?: number;

    /**
     * 貸付金の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfLoansReceivableInvCF?: number;

    /**
     * 有価証券の売却及び償還による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesAndRedemptionOfSecuritiesInvCF?: number;

    /**
     * 有価証券の償還による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromRedemptionOfSecuritiesInvCF?: number;

    /**
     * 投資有価証券の償還による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromRedemptionOfInvestmentSecuritiesInvCF?: number;

    /**
     * 投資有価証券の売却及び償還による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesAndRedemptionOfInvestmentSecuritiesInvCF?: number;

    /**
     * 有価証券及び投資有価証券の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfShortTermAndLongTermInvestmentSecuritiesInvCF?: number;

    /**
     * 有価証券及び投資有価証券の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfShortTermAndLongTermInvestmentSecuritiesInvCF?: number;

    /**
     * 有価証券及び投資有価証券の売却及び償還による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesAndRedemptionOfShortTermAndLongTermInvestmentSecuritiesInvCF?: number;

    /**
     * 無形固定資産の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfIntangibleAssetsInvCF?: number;

    /**
     * 無形固定資産の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfIntangibleAssetsInvCF?: number;

    /**
     * 有形及び無形固定資産の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCF?: number;

    /**
     * 有形及び無形固定資産の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCF?: number;

    /**
     * 固定資産の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfNoncurrentAssetsInvCF?: number;

    /**
     * 固定資産の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfNoncurrentAssetsInvCF?: number;

    /**
     * 固定資産の除却による支出
     * Namespace: jppfs_cor
     */
    PaymentsForRetirementOfNoncurrentAssetsInvCF?: number;

    /**
     * 有形固定資産の除却による支出
     * Namespace: jppfs_cor
     */
    PaymentsForRetirementOfPropertyPlantAndEquipmentInvCF?: number;

    /**
     * 資産除去債務の履行による支出
     * Namespace: jppfs_cor
     */
    PaymentsForAssetRetirementObligationsInvCF?: number;

    /**
     * ゴルフ会員権の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfGolfClubMembershipsInvCF?: number;

    /**
     * ゴルフ会員権の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfGolfClubMembershipsInvCF?: number;

    /**
     * 会員権の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfMembershipsInvCF?: number;

    /**
     * 会員権の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfMembershipInvCF?: number;

    /**
     * 関係会社貸付けによる支出
     * Namespace: jppfs_cor
     */
    PaymentsOfLoansReceivableToSubsidiariesAndAffiliatesInvCF?: number;

    /**
     * 関係会社出資金の払込による支出
     * Namespace: jppfs_cor
     */
    PaymentsForInvestmentsInCapitalOfSubsidiariesAndAffiliatesInvCF?: number;

    /**
     * 関係会社の整理による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromLiquidationOfSubsidiariesAndAffiliatesInvCF?: number;

    /**
     * 建設協力金の支払による支出
     * Namespace: jppfs_cor
     */
    PaymentsOfConstructionAssistanceFundReceivablesInvCF?: number;

    /**
     * 建設協力金の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfConstructionAssistanceFundReceivablesInvCF?: number;

    /**
     * 工事負担金等受入による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromContributionReceivedForConstructionInvCF?: number;

    /**
     * 定期預金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInTimeDepositsInvCF?: number;

    /**
     * 定期預金の純増減額（△は増加）
     * Namespace: jppfs_cor
     */
    NetDecreaseIncreaseInTimeDepositsInvCF?: number;

    /**
     * 定期預金の預入による支出
     * Namespace: jppfs_cor
     */
    PaymentsIntoTimeDepositsInvCF?: number;

    /**
     * 定期預金の払戻による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromWithdrawalOfTimeDepositsInvCF?: number;

    /**
     * 子会社出資金の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfInvestmentsInCapitalOfSubsidiariesInvCF?: number;

    /**
     * 子会社の清算による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromLiquidationOfSubsidiariesInvCF?: number;

    /**
     * 子会社株式の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfInvestmentsInSubsidiariesInvCF?: number;

    /**
     * 子会社株式の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfInvestmentsInSubsidiariesInvCF?: number;

    /**
     * 子会社の自己株式の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfTreasuryStockOfSubsidiariesInConsolidationInvCF?: number;

    /**
     * 関係会社株式の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfStocksOfSubsidiariesAndAffiliatesInvCF?: number;

    /**
     * 関係会社株式の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfStocksOfSubsidiariesAndAffiliatesInvCF?: number;

    /**
     * 事業譲渡による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromTransferOfBusinessInvCF?: number;

    /**
     * 営業譲受による支出
     * Namespace: jppfs_cor
     */
    PaymentsForTransferOfBusinessInvCF?: number;

    /**
     * 事業譲受による支出
     * Namespace: jppfs_cor
     */
    PaymentsForTransferOfBusiness2InvCF?: number;

    /**
     * のれんの取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfGoodwillInvCF?: number;

    /**
     * 社用資産の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfOwnUsedAssetsInvCF?: number;

    /**
     * 社用資産の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfOwnUsedAssetsInvCF?: number;

    /**
     * 出資金の払込による支出
     * Namespace: jppfs_cor
     */
    PaymentsForInvestmentsInCapitalInvCF?: number;

    /**
     * 出資金の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfInvestmentsInCapitalInvCF?: number;

    /**
     * 出資金の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfInvestmentsInCapitalInvCF?: number;

    /**
     * 出資金の分配による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromShareOfProfitsOnInvestmentsInCapitalInvCF?: number;

    /**
     * 親会社株式の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfStocksOfParentCompanyInvCF?: number;

    /**
     * 投資不動産の取得による支出
     * Namespace: jppfs_cor
     */
    PaymentsForInvestmentsInRealEstatesInvCF?: number;

    /**
     * 投資不動産の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfInvestmentsInRealEstatesInvCF?: number;

    /**
     * 短期貸付金の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInShortTermLoansReceivableInvCF?: number;

    /**
     * 短期貸付金の純増減額（△は増加）
     * Namespace: jppfs_cor
     */
    NetDecreaseIncreaseInShortTermLoansReceivableInvCF?: number;

    /**
     * 短期貸付けによる支出
     * Namespace: jppfs_cor
     */
    PaymentsOfShortTermLoansReceivableInvCF?: number;

    /**
     * 短期貸付金の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfShortTermLoansReceivableInvCF?: number;

    /**
     * 長期貸付けによる支出
     * Namespace: jppfs_cor
     */
    PaymentsOfLongTermLoansReceivableInvCF?: number;

    /**
     * 長期貸付金の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfLongTermLoansReceivableInvCF?: number;

    /**
     * 従業員に対する貸付けによる支出
     * Namespace: jppfs_cor
     */
    PaymentsOfLoansReceivableToEmployeesInvCF?: number;

    /**
     * 従業員に対する貸付金の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfLoansReceivableToEmployeesInvCF?: number;

    /**
     * 従業員に対する長期貸付けによる支出
     * Namespace: jppfs_cor
     */
    PaymentsOfLongTermLoansReceivableToEmployeesInvCF?: number;

    /**
     * 従業員に対する長期貸付金の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfLongTermLoansReceivableToEmployeesInvCF?: number;

    /**
     * 投融資による支出
     * Namespace: jppfs_cor
     */
    PaymentsOfInvestmentAndLoansReceivableInvCF?: number;

    /**
     * 投融資の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfInvestmentAndLoansReceivableInvCF?: number;

    /**
     * 投資不動産の賃貸による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromRentalOfRealEstateForInvestmentInvCF?: number;

    /**
     * 繰延資産の取得による支出
     * Namespace: jppfs_cor
     */
    PaymentsForDeferredAssetsInvCF?: number;

    /**
     * 匿名組合出資金の払込による支出
     * Namespace: jppfs_cor
     */
    PaymentsForInvestmentsInSilentPartnershipInvCF?: number;

    /**
     * 匿名組合出資金の払戻による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromWithdrawalOfInvestmentsInSilentPartnershipInvCF?: number;

    /**
     * 金銭の信託の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfMoneyHeldInTrustInvCF?: number;

    /**
     * 金銭の信託の解約による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromCancellationOfMoneyHeldInTrustInvCF?: number;

    /**
     * 信託受益権の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfTrustBeneficiaryRightInvCF?: number;

    /**
     * 信託受益権の償還による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromRedemptionOfTrustBeneficiaryRightInvCF?: number;

    /**
     * 信託受益権の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfTrustBeneficiaryRightInvCF?: number;

    /**
     * 投資事業組合からの分配による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromDistributionOfInvestmentInPartnershipsInvCF?: number;

    /**
     * その他の無形固定資産の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfOtherIntangibleAssetsInvCF?: number;

    /**
     * 保険積立金の積立による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfInsuranceFundsInvCF?: number;

    /**
     * 保険積立金の解約による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromCancellationOfInsuranceFundsInvCF?: number;

    /**
     * 保険積立金の払戻による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromMaturityOfInsuranceFundsInvCF?: number;

    /**
     * ソフトウエアの取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfSoftwareInvCF?: number;

    /**
     * リース用資産の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfPropertyForLeaseInvCF?: number;

    /**
     * 差入保証金の差入による支出
     * Namespace: jppfs_cor
     */
    PaymentsForGuaranteeDepositsInvCF?: number;

    /**
     * 差入保証金の回収による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromCollectionOfGuaranteeDepositsInvCF?: number;

    /**
     * 敷金及び保証金の差入による支出
     * Namespace: jppfs_cor
     */
    PaymentsForLeaseAndGuaranteeDepositsInvCF?: number;

    /**
     * 敷金及び保証金の回収による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromCollectionOfLeaseAndGuaranteeDepositsInvCF?: number;

    /**
     * 預り保証金の返還による支出
     * Namespace: jppfs_cor
     */
    RepaymentsOfGuaranteeDepositsReceivedInvCF?: number;

    /**
     * 預り保証金の受入による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromGuaranteeDepositsReceivedInvCF?: number;

    /**
     * 敷金の差入による支出
     * Namespace: jppfs_cor
     */
    PaymentsForLeaseDepositsInvCF?: number;

    /**
     * 敷金の回収による収入
     * Namespace: jppfs_cor
     */
    CollectionOfLeaseDepositsInvCF?: number;

    /**
     * 長期前払費用の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfLongTermPrepaidExpensesInvCF?: number;

    /**
     * 長期預り金の返還による支出
     * Namespace: jppfs_cor
     */
    RepaymentsOfLongTermDepositsReceivedInvCF?: number;

    /**
     * 長期預り金の受入による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromLongTermDepositsReceivedInvCF?: number;

    /**
     * 長期預り保証金の返還による支出
     * Namespace: jppfs_cor
     */
    RepaymentsOfLongTermGuaranteeDepositsInvCF?: number;

    /**
     * 投資その他の資産の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInOtherInvestmentsInvCF?: number;

    /**
     * 連結の範囲の変更を伴う子会社株式の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfInvestmentsInSubsidiariesResultingInChangeInScopeOfConsolidationInvCF?: number;

    /**
     * 連結の範囲の変更を伴う子会社株式の取得による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromPurchaseOfInvestmentsInSubsidiariesResultingInChangeInScopeOfConsolidationInvCF?: number;

    /**
     * 連結の範囲の変更を伴う子会社株式の売却による支出
     * Namespace: jppfs_cor
     */
    PaymentsForSalesOfInvestmentsInSubsidiariesResultingInChangeInScopeOfConsolidationInvCF?: number;

    /**
     * 連結の範囲の変更を伴う子会社株式の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfInvestmentsInSubsidiariesResultingInChangeInScopeOfConsolidationInvCF?: number;

    /**
     * 補助金の受取額
     * Namespace: jppfs_cor
     */
    SubsidiesReceivedInvCF?: number;

    /**
     * その他の支出
     * Namespace: jppfs_cor
     */
    OtherPaymentsInvCF?: number;

    /**
     * その他の収入
     * Namespace: jppfs_cor
     */
    OtherProceedsInvCF?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherNetInvCF?: number;

    /**
     * 投資活動によるキャッシュ・フロー
     * Namespace: jppfs_cor
     */
    NetCashProvidedByUsedInInvestmentActivities?: number;

    /**
     * 財務活動によるキャッシュ・フロー
     * Namespace: jppfs_cor
     */
    NetCashProvidedByUsedInFinancingActivitiesAbstract?: string;

    /**
     * 短期借入れによる収入
     * Namespace: jppfs_cor
     */
    IncreaseInShortTermLoansPayableFinCF?: number;

    /**
     * 短期借入金の返済による支出
     * Namespace: jppfs_cor
     */
    DecreaseInShortTermLoansPayableFinCF?: number;

    /**
     * 長期借入れによる収入
     * Namespace: jppfs_cor
     */
    ProceedsFromLongTermLoansPayableFinCF?: number;

    /**
     * 長期借入金の返済による支出
     * Namespace: jppfs_cor
     */
    RepaymentOfLongTermLoansPayableFinCF?: number;

    /**
     * 社債の発行による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromIssuanceOfBondsFinCF?: number;

    /**
     * 社債の償還による支出
     * Namespace: jppfs_cor
     */
    RedemptionOfBondsFinCF?: number;

    /**
     * 株式の発行による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromIssuanceOfCommonStockFinCF?: number;

    /**
     * 自己株式の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfTreasuryStockFinCF?: number;

    /**
     * 配当金の支払額
     * Namespace: jppfs_cor
     */
    CashDividendsPaidFinCF?: number;

    /**
     * 非支配株主への配当金の支払額
     * Namespace: jppfs_cor
     */
    DividendsPaidToNonControllingInterestsFinCF?: number;

    /**
     * 連結の範囲の変更を伴わない子会社株式の取得による支出
     * Namespace: jppfs_cor
     */
    PaymentsFromChangesInOwnershipInterestsInSubsidiariesThatDoNotResultInChangeInScopeOfConsolidationFinCF?: number;

    /**
     * 連結の範囲の変更を伴わない子会社株式の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromChangesInOwnershipInterestsInSubsidiariesThatDoNotResultInChangeInScopeOfConsolidationFinCF?: number;

    /**
     * 短期借入金の純増減額（△は減少）
     * Namespace: jppfs_cor
     */
    NetIncreaseDecreaseInShortTermLoansPayableFinCF?: number;

    /**
     * 短期借入金の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInShortTermLoansPayableFinCF?: number;

    /**
     * 借入金の返済による支出
     * Namespace: jppfs_cor
     */
    RepaymentsOfLoansPayableFinCF?: number;

    /**
     * 借入れによる収入
     * Namespace: jppfs_cor
     */
    ProceedsFromLoansPayableFinCF?: number;

    /**
     * 転換社債の償還による支出
     * Namespace: jppfs_cor
     */
    RedemptionOfConvertibleBondsFinCF?: number;

    /**
     * 株式の発行による支出
     * Namespace: jppfs_cor
     */
    PaymentsForIssuanceOfCommonStockFinCF?: number;

    /**
     * 非支配株主からの払込みによる収入
     * Namespace: jppfs_cor
     */
    ProceedsFromShareIssuanceToNonControllingShareholdersFinCF?: number;

    /**
     * 非支配株主への払戻による支出
     * Namespace: jppfs_cor
     */
    RepaymentsToNonControllingShareholdersFinCF?: number;

    /**
     * リース債務の返済による支出
     * Namespace: jppfs_cor
     */
    RepaymentsOfLeaseObligationsFinCF?: number;

    /**
     * ファイナンス・リース債務の返済による支出
     * Namespace: jppfs_cor
     */
    RepaymentsOfFinanceLeaseObligationsFinCF?: number;

    /**
     * セール・アンド・リースバックによる収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSaleAndLeasebackFinCF?: number;

    /**
     * コマーシャル・ペーパーの償還による支出
     * Namespace: jppfs_cor
     */
    RedemptionOfCommercialPapersFinCF?: number;

    /**
     * コマーシャル・ペーパーの発行による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromIssuanceOfCommercialPapersFinCF?: number;

    /**
     * コマーシャル・ペーパーの増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInCommercialPapersFinCF?: number;

    /**
     * コマーシャル・ペーパーの純増減額（△は減少）
     * Namespace: jppfs_cor
     */
    NetIncreaseDecreaseInCommercialPapersFinCF?: number;

    /**
     * 短期借入金及びコマーシャル・ペーパーの増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInShortTermBankLoansAndCommercialPapersFinCF?: number;

    /**
     * 長期未払金の返済による支出
     * Namespace: jppfs_cor
     */
    PaymentsForLongTermAccountsPayableOtherFinCF?: number;

    /**
     * ストックオプションの行使による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromExerciseOfStockOptionFinCF?: number;

    /**
     * 自己株式の処分による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromDisposalOfTreasuryStockFinCF?: number;

    /**
     * 自己株式の売却による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromSalesOfTreasuryStockFinCF?: number;

    /**
     * 自己株式の増減額（△は増加）
     * Namespace: jppfs_cor
     */
    DecreaseIncreaseInTreasuryStockFinCF?: number;

    /**
     * 自己株式の純増減額（△は増加）
     * Namespace: jppfs_cor
     */
    NetDecreaseIncreaseInTreasuryStockFinCF?: number;

    /**
     * 子会社の自己株式の取得による支出
     * Namespace: jppfs_cor
     */
    PurchaseOfTreasuryStockOfSubsidiariesInConsolidationFinCF?: number;

    /**
     * 子会社の自己株式の処分による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromDisposalOfTreasuryStockOfSubsidiariesInConsolidationFinCF?: number;

    /**
     * 新株予約権の行使による株式の発行による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromIssuanceOfStockResultingFromExerciseOfSubscriptionRightsToSharesFinCF?: number;

    /**
     * 新株予約権付社債の発行による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromIssuanceOfBondsWithSubscriptionRightsToSharesFinCF?: number;

    /**
     * 新株予約権の発行による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromIssuanceOfSubscriptionRightsToSharesFinCF?: number;

    /**
     * 短期社債の純増減額（△は減少）
     * Namespace: jppfs_cor
     */
    NetIncreaseDecreaseInShortTermBondsPayableFinCF?: number;

    /**
     * 短期社債の発行による収入
     * Namespace: jppfs_cor
     */
    ProceedsFromIssuanceOfShortTermBondsFinCF?: number;

    /**
     * 短期社債の償還による支出
     * Namespace: jppfs_cor
     */
    RedemptionOfShortTermBondsFinCF?: number;

    /**
     * 割賦債務の返済による支出
     * Namespace: jppfs_cor
     */
    RepaymentsOfInstallmentPayablesFinCF?: number;

    /**
     * 設備関係割賦債務の返済による支出
     * Namespace: jppfs_cor
     */
    PaymentsForInstallmentPayablesPropertyAndEquipmentFinCF?: number;

    /**
     * 会員預り金の返還による支出
     * Namespace: jppfs_cor
     */
    RepaymentsForDepositsReceivedFromMembershipFinCF?: number;

    /**
     * 上場関連費用の支出
     * Namespace: jppfs_cor
     */
    PaymentsOfListingExpensesFinCF?: number;

    /**
     * その他の支出
     * Namespace: jppfs_cor
     */
    OtherPaymentsFinCF?: number;

    /**
     * その他の収入
     * Namespace: jppfs_cor
     */
    OtherProceedsFinCF?: number;

    /**
     * その他
     * Namespace: jppfs_cor
     */
    OtherNetFinCF?: number;

    /**
     * 財務活動によるキャッシュ・フロー
     * Namespace: jppfs_cor
     */
    NetCashProvidedByUsedInFinancingActivities?: number;

    /**
     * 現金及び現金同等物に係る換算差額
     * Namespace: jppfs_cor
     */
    EffectOfExchangeRateChangeOnCashAndCashEquivalents?: number;

    /**
     * 現金及び現金同等物の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    NetIncreaseDecreaseInCashAndCashEquivalents?: number;

    /**
     * 新規連結に伴う現金及び現金同等物の増加額
     * Namespace: jppfs_cor
     */
    IncreaseInCashAndCashEquivalentsFromNewlyConsolidatedSubsidiaryCCE?: number;

    /**
     * 連結除外に伴う現金及び現金同等物の減少額
     * Namespace: jppfs_cor
     */
    DecreaseInCashAndCashEquivalentsResultingFromExclusionOfSubsidiariesFromConsolidationCCE?: number;

    /**
     * 連結の範囲の変更に伴う現金及び現金同等物の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInCashAndCashEquivalentsResultingFromChangeOfScopeOfConsolidationCCE?: number;

    /**
     * 合併に伴う現金及び現金同等物の増加額
     * Namespace: jppfs_cor
     */
    IncreaseInCashAndCashEquivalentsResultingFromMergerCCE?: number;

    /**
     * 連結子会社の合併による現金及び現金同等物の増減額（△は減少）
     * Namespace: jppfs_cor
     */
    IncreaseDecreaseInCashAndCashEquivalentsResultingFromMergerOfSubsidiariesCCE?: number;

    /**
     * 非連結子会社との合併に伴う現金及び現金同等物の増加額
     * Namespace: jppfs_cor
     */
    IncreaseInCashAndCashEquivalentsResultingFromMergerWithUnconsolidatedSubsidiariesCCE?: number;

    /**
     * 現金及び現金同等物の残高
     * Namespace: jppfs_cor
     */
    CashAndCashEquivalents?: number;
}
