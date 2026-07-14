进入内核态后，Hook 的威力和隐蔽性都大幅提升，但同时要面对 PatchGuard 这个「巡逻兵」。以下这些传统内核 Hook 技术在 Windows XP/7 时代是主流，但在 Win10+ 环境下大部分已经被 PatchGuard 监控。
2.1 SSDT Hook（系统服务描述符表 Hook）

----------------------------

### 原理

SSDT（System Service Descriptor Table）是内核中的一张函数指针表，syscall 进入内核后通过 SSN 索引到这张表找到对应的内核函数。修改表项即可拦截所有系统调用。

### 完整实现

```c
#include <ntddk.h>

typedef struct _KSERVICE_TABLE_DESCRIPTOR {
    PLONG Base;            // 函数偏移表基地址（Win64 存的是相对偏移）
    PULONG Count;          // 调用计数表
    ULONG Limit;           // 最大服务号
    PUCHAR Number;         // 参数字节数表
} KSERVICE_TABLE_DESCRIPTOR, *PKSERVICE_TABLE_DESCRIPTOR;

// KeServiceDescriptorTable 是导出符号（仅 x86），x64 需要手动定位
extern PKSERVICE_TABLE_DESCRIPTOR KeServiceDescriptorTable;

// x64 SSDT 使用相对偏移而非绝对地址
// 实际地址 = Base + (Base[SSN] >> 4)
// 低 4 位存储参数字节数

// 定位 SSDT（x64 方式：通过 KiSystemServiceRepeat 签名扫描）
PVOID FindSsdtBase() {
// KiSystemCall64 中的特征码搜索
// 4C 8D 15 XX XX XX XX  lea r10, [KeServiceDescriptorTable]
    ULONG64 kiSystemCall = __readmsr(0xC0000082); // IA32_LSTAR

// 从 KiSystemCall64 开始扫描特征码
for (ULONG i = 0; i < 0x500; i++) {
// 寻找 lea r10, [rip + offset] (4C 8D 15)
if (*(USHORT*)((BYTE*)kiSystemCall + i) == 0x8D4C &&
            *((BYTE*)kiSystemCall + i + 2) == 0x15) {
            INT32 offset = *(INT32*)((BYTE*)kiSystemCall + i + 3);
            PVOID ssdt = (PVOID)((BYTE*)kiSystemCall + i + 7 + offset);
return ssdt;
        }
    }
return NULL;
}

// 读取 SSDT 中某个 SSN 对应的内核函数地址
PVOID GetSsdtFunctionAddress(ULONG ssn) {
    PKSERVICE_TABLE_DESCRIPTOR ssdt = (PKSERVICE_TABLE_DESCRIPTOR)FindSsdtBase();
if (!ssdt || ssn >= ssdt->Limit) return NULL;

    LONG offset = ssdt->Base[ssn] >> 4;
return (PVOID)((BYTE*)ssdt->Base + offset);
}

// 修改 SSDT 条目（需要关闭写保护）
NTSTATUS HookSsdtEntry(ULONG ssn, PVOID hookFunction, PVOID* originalFunction) {
    PKSERVICE_TABLE_DESCRIPTOR ssdt = (PKSERVICE_TABLE_DESCRIPTOR)FindSsdtBase();
if (!ssdt || ssn >= ssdt->Limit) return STATUS_INVALID_PARAMETER;

// 保存原始函数地址
    LONG origOffset = ssdt->Base[ssn] >> 4;
    *originalFunction = (PVOID)((BYTE*)ssdt->Base + origOffset);

// 计算新的偏移
    LONG newOffset = (LONG)((BYTE*)hookFunction - (BYTE*)ssdt->Base);
    LONG newEntry = (newOffset << 4) | (ssdt->Base[ssn] & 0xF); // 保留低4位

// 关闭 CR0.WP 位（禁用写保护）
    ULONG64 cr0 = __readcr0();
    __writecr0(cr0 & ~0x10000);

// 关中断防止竞态
    _disable();

// 写入新偏移
InterlockedExchange(&ssdt->Base[ssn], newEntry);

    _enable();
    __writecr0(cr0);

return STATUS_SUCCESS;
}

// Hook 函数示例：拦截 NtOpenProcess
typedef NTSTATUS(*fnNtOpenProcess)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PCLIENT_ID);
fnNtOpenProcess OriginalNtOpenProcess = NULL;

NTSTATUS HookedNtOpenProcess(PHANDLE ProcessHandle, ACCESS_MASK DesiredAccess,
    POBJECT_ATTRIBUTES ObjectAttributes, PCLIENT_ID ClientId) {
// 保护特定进程
if (ClientId && ClientId->UniqueProcess == (HANDLE)g_protectedPid) {
return STATUS_ACCESS_DENIED;
    }
return OriginalNtOpenProcess(ProcessHandle, DesiredAccess, ObjectAttributes, ClientId);
}
```
